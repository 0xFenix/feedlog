import { z } from 'zod'
import { uuidv7 } from 'uuidv7'
import { toAISdkStream } from '@mastra/ai-sdk'
import { createEventStream, type H3Event } from 'h3'
import { chatInput, contentSchema } from '#layers/feedlog/shared/agent/content'
import { type Actor, agentRuntime, agentError, transaction, lockConversation, appendItem } from '#layers/feedlog/server/lib/agent/runtime'
import { handoff } from '../inbox/service'
import { syncConversationTask, syncRunTask, replyCloseDelayMs } from '../inbox/tasks'
import { requestSchedule } from '../inbox/platform'
import { handling } from '../../../shared/inbox/state'
import { publicItem, publicRun } from './runtime'
import { startRun } from '#layers/feedlog/server/lib/agent/conversations'
import { prepareAgent, customerMemoryMessage } from '#layers/feedlog/server/lib/agent/agent'
import { collectConversationReply } from '#layers/feedlog/server/lib/agent/stream'
import { keepVerifiedHelpReferences, removeUnverifiedAnswerLinks, verifyHelpCitations } from '#layers/feedlog/server/lib/agent/citation-evidence'
import { addTokenUsage, type RunTokenUsage } from '#layers/feedlog/shared/agent/usage'

export async function streamAgentReply(event: H3Event, actor: Actor) {
  await assertGuestMay(event, actor.session, 'allowPost')
  const parsedId = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!parsedId.success) agentError(404, 'conversation_not_found', 'Conversation not found')
  const id = parsedId.data
  const parsed = chatInput.safeParse(await readBody(event).catch(() => null))
  if (!parsed.success) agentError(422, 'invalid_message', 'Message content or parameters are invalid')
  const runtime = agentRuntime(event)
  if (parsed.data.action === 'send') {
    // Validate attachment access before committing the input or starting a run.
    await customerMemoryMessage(event, { ...parsed.data.message, author_user_id: actor.customerId, conversation_id: id, seq: 0, created_at: new Date() }, `${actor.orgId}:${id}`, actor.orgId)
      .catch(() => agentError(422, 'invalid_message', 'An image could not be read'))
  }
  if (!await checkRateLimit(`widget-messages:${actor.customerId}`, { limit: 20, windowSeconds: 60 })) agentError(429, 'rate_limited', 'Too many messages; try again shortly')
  const execution = await startRun(runtime, id, actor, parsed.data)
  if (execution.run && !execution.duplicate) await requestSchedule(event)
  if (execution.duplicate || !execution.run) return {
    accepted: true, duplicate: execution.duplicate, mode: execution.mode,
    item: publicItem(execution.item), run: execution.run ? publicRun(execution.run) : null,
    conversation: { id, title: execution.conversation.title, lastSeq: Number(execution.conversation.last_seq), unread: execution.conversation.unread, handling: handling(execution.conversation.status) },
  }
  const { run, item } = execution
  const replyId = uuidv7()
  const stream = createEventStream(event)
  const send = (name: string, data: unknown) => stream.push({ event: name, data: JSON.stringify(data) }).catch(() => {})
  const task = (async () => {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, new Date(run.deadline_at).getTime() - Date.now()))])
    let checking = false
    const watch = setInterval(async () => {
      if (checking) return
      checking = true
      try {
        const { rows: [active] } = await runtime.pool.query("SELECT id FROM agent_run WHERE id=$1 AND status='running'", [run.id])
        if (!active) controller.abort()
      } catch { controller.abort() }
      finally { checking = false }
    }, 1000)
    let usage: RunTokenUsage | null = null
    let prepared: Awaited<ReturnType<typeof prepareAgent>> | undefined
    try {
      await send('run', { runId: run.id, itemId: replyId })
      prepared = await prepareAgent(event, actor, id, run, item, signal, () => {}, () => controller.abort())
      let failed = false
      const output = await prepared.agent.stream([prepared.input], {
        runId: run.id, memory: { thread: id, resource: prepared.resourceId, options: { lastMessages: prepared.historySize } },
        maxSteps: 12, toolCallConcurrency: 1, abortSignal: signal, onError: () => { failed = true }, onAbort: () => { failed = true },
        onStepFinish: async step => {
          usage = addTokenUsage(usage, step.usage)
          // Preserve reported costs even when a later step fails; metrics must not interrupt a reply.
          await runtime.pool.query('UPDATE agent_run SET usage=$2 WHERE id=$1', [run.id, JSON.stringify(usage)])
            .catch(() => console.warn('[agent] Could not persist step token usage', { runId: run.id }))
        },
      })
      const reply = await collectConversationReply(toAISdkStream(output, { from: 'agent', version: 'v7', sendReasoning: false, sendSources: false }), replyId, chunk => {
        if (chunk.type === 'text-delta') void send('text', { runId: run.id, itemId: replyId, delta: chunk.delta })
      })
      if (failed || signal.aborted) throw new Error('Model execution did not complete')
      await runtime.memory.settled()
      let text = reply.message.parts.filter(part => part.type === 'text').map(part => part.text).join('\n\n').trim()
      let parts = await prepared.resultParts()
      const citedIds = [...new Set(parts.flatMap(part => part.type === 'article_reference'
        ? part.articles.map(article => article.article_id) : []))]
      if (text && citedIds.length) {
        const { rows: candidates } = await runtime.pool.query<{ id: string; title: string; content: string }>(
          'SELECT id,title,content FROM help_article WHERE id=ANY($1::uuid[]) AND org_id=$2 AND ai_enabled',
          [citedIds, actor.orgId],
        )
        const question = item.content.parts.filter(part => part.type === 'text').map(part => part.text).join('\n')
        const verdict = await verifyHelpCitations(question, text, candidates, {
          timeoutMs: Math.max(1000, Math.min(12000, new Date(run.deadline_at).getTime() - Date.now() - 1000)),
        })
        if (verdict.status === 'unavailable') console.warn('[agent] Citation verification unavailable', { runId: run.id })
        const verifiedIds = new Set(verdict.matches.map(match => match.id))
        parts = keepVerifiedHelpReferences(parts, verifiedIds)
        text = removeUnverifiedAnswerLinks(text, candidates, verifiedIds)
      }
      const content = contentSchema.parse({ parts: [...(text ? [{ type: 'text', text }] : []), ...parts] })
      const lastSeq = await transaction(runtime, async client => {
        await lockConversation(client, id, actor)
        const { rowCount } = await client.query("SELECT id FROM agent_run WHERE id=$1 AND status='running' AND deadline_at>clock_timestamp()", [run.id])
        if (!rowCount) throw new Error('Run no longer active')
        const reply = await appendItem(client, { id: replyId, conversationId: id, author: 'agent', content, runId: run.id })
        await client.query("UPDATE conversation SET state_due_at=$2::timestamptz WHERE id=$1 AND status='ai_handling'", [id, new Date(new Date(reply.created_at).getTime() + replyCloseDelayMs())])
        await client.query("UPDATE agent_run SET status='completed',finished_at=now(),usage=$2 WHERE id=$1", [run.id, usage ? JSON.stringify(usage) : null])
        await syncConversationTask(client, id)
        await syncRunTask(client, run.id)
        return Number(reply.seq)
      })
      await requestSchedule(event)
      await send('finish', { runId: run.id, itemId: replyId, lastSeq })
    } catch {
      try {
        const feedbackResults = await prepared?.feedbackResults().catch(() => []) ?? []
        await handoff(runtime, id, actor.orgId, run.id, 'ai_error', true, undefined, feedbackResults)
        const { rows: [current] } = await runtime.pool.query('SELECT status,last_seq FROM conversation WHERE id=$1 AND org_id=$2', [id, actor.orgId])
        if (current && current.status !== 'ai_handling') {
          await send(current.status === 'closed' ? 'closed' : 'handoff', { runId: run.id, noticeItemId: `handoff:${run.id}`, lastSeq: Number(current.last_seq), handling: handling(current.status) })
        }
        // A closed conversation may already have reopened. Never let the old run
        // announce a handoff or append a reply into that new round.
      } catch { await send('error', { runId: run.id, code: 'storage_unavailable', message: 'Connection interrupted. Please retry with the same message.' }) }
    } finally { clearInterval(watch); await stream.close() }
  })()
  event.context.feedlogAgentTask = task
  event.waitUntil(task)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return stream.send()
}
