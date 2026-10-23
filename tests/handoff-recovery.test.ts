import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { recoverHandoffDecision, HandoffProtocolError } from '../server/lib/agent/handoff-protocol'
import { getEnabledSupportRules } from '../shared/utils/widget-settings'

test('recovery validates rule IDs and cannot outlive a cancelled run', async () => {
  let decision: unknown = { reason: 'support_rule', rule_id: 'builtin-billing' }
  let requests = 0
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* Consume the model request. */ }
    requests++
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ id: 'mock', object: 'chat.completion', created: 0, model: 'mock',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(decision) } }],
      usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 } }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const keys = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_TEXT_MODEL']
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  try {
    process.env.OPENAI_API_KEY = 'synthetic-test-key'
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    process.env.OPENAI_TEXT_MODEL = 'mock'
    const input = { messages: [{ role: 'customer', text: 'Please process my refund.' }], rules: getEnabledSupportRules() }
    const run = (signal = new AbortController().signal) => recoverHandoffDecision(input, signal, async () => {})
    assert.deepEqual(await run(), { reason: 'support_rule', rule_id: 'builtin-billing' })
    decision = { reason: 'support_rule', rule_id: 'unconfigured-rule' }
    await assert.rejects(run(), HandoffProtocolError)
    decision = { reason: 'user_requested', rule_id: 'builtin-billing' }
    await assert.rejects(run(), HandoffProtocolError)
    decision = { reason: null, rule_id: null }
    await assert.rejects(run(), HandoffProtocolError)
    const before = requests
    await assert.rejects(run(AbortSignal.abort(new Error('Run expired'))), /Run expired/)
    assert.equal(requests, before)
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
