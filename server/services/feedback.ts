import { lockFeedback } from './feedback-lock'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { board, comment, commentLike, conversation, message, post, postSearch, postSubscription, postUnread, vote } from '../db/schemas'
import { createPostSchema, updatePostSchema } from '../../shared/schemas/post'
import { createPostRecord } from '../utils/post-create'
import { contentError, isModerator, requireModerator, type ContentReader, type ContentContext } from './content-context'

export async function feedbackRecord(context: ContentReader, id: string) {
  const [record] = await context.db.select().from(post).where(and(eq(post.id, id), eq(post.orgId, context.orgId)))
  if (!record) throw contentError(404, 'Feedback not found')
  return record
}
async function assertBoard(context: ContentContext, id?: string | null) {
  if (!id) return
  const [record] = await context.db.select().from(board).where(and(eq(board.id, id), eq(board.orgId, context.orgId))).for('share')
  if (!record) throw contentError(404, 'Board not found')
}
export async function createFeedback(context: ContentContext, body: z.infer<typeof createPostSchema>, source: 'portal' | 'mcp' = 'portal') {
  const input = createPostSchema.parse(body)
  await lockFeedback(context)
  await assertBoard(context, input.boardId)
  const record = await createPostRecord({ ...input, orgId: context.orgId, authorId: context.userId, subscribeAuthor: !isModerator(context) }, context.db)
  context.afterCommit.push(() => publishDomainEvent(context.event, createDomainEvent({
    name: 'feedback.created', orgId: context.orgId, userId: context.userId,
    data: { feedbackId: record.id, boardId: record.boardId, source, messageId: null },
  })))
  return record
}
export async function updateFeedback(context: ContentContext, id: string, body: z.infer<typeof updatePostSchema>) {
  const input = updatePostSchema.parse(body)
  if (!Object.values(input).some(value => value !== undefined)) throw contentError(400, 'No fields to update')
  await lockFeedback(context)
  const existing = await feedbackRecord(context, id)
  if (existing.authorId !== context.userId || input.status !== undefined || input.boardId !== undefined) requireModerator(context)
  await assertBoard(context, input.boardId)
  const title = input.title ?? existing.title
  const content = input.content ?? existing.content
  const changed = title !== existing.title || content !== existing.content
  const contentHash = changed ? computeContentHash(title, content) : existing.contentHash
  const [record] = await context.db.update(post).set({ ...input, ...(changed ? { contentHash, excerpt: generateExcerpt(content) } : {}) }).where(and(eq(post.id, id), eq(post.orgId, context.orgId))).returning()
  if (changed) {
    const searchText = stripMarkdown(title + '\n' + content)
    await context.db.insert(postSearch).values({ postId: id, orgId: context.orgId, searchText }).onConflictDoUpdate({ target: postSearch.postId, set: { searchText } })
    context.afterCommit.push(() => generatePostEmbedding(id, context.orgId, title, content, contentHash!))
  }
  return record!
}
export async function deleteFeedback(context: ContentContext, id: string) {
  requireModerator(context)
  await lockFeedback(context)
  const existing = await feedbackRecord(context, id)
  const [child] = await context.db.select({ id: post.id }).from(post).where(and(eq(post.mergedTo, id), eq(post.orgId, context.orgId))).limit(1)
  if (existing.mergedTo || child) throw contentError(400, 'Unmerge this feedback and its children before deleting it')
  await context.db.delete(commentLike).where(inArray(commentLike.commentId, context.db.select({ id: comment.id }).from(comment).where(eq(comment.postId, id))))
  await context.db.delete(comment).where(eq(comment.postId, id))
  await context.db.delete(vote).where(eq(vote.postId, id))
  await context.db.delete(postSubscription).where(eq(postSubscription.postId, id))
  await context.db.delete(postUnread).where(eq(postUnread.postId, id))
  await context.db.update(message).set({ postId: null }).where(and(eq(message.postId, id), inArray(message.conversationId, context.db.select({ id: conversation.id }).from(conversation).where(eq(conversation.orgId, context.orgId)))))
  await context.db.delete(post).where(and(eq(post.id, id), eq(post.orgId, context.orgId)))
  return { id, deleted: true }
}
async function recalculateAncestors(context: ContentContext, id: string) {
  const ancestors = await context.db.execute<{ id: string }>(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, merged_to FROM post WHERE id = ${id} AND org_id = ${context.orgId}
      UNION SELECT p.id, p.merged_to FROM post p JOIN ancestors a ON p.id = a.merged_to WHERE p.org_id = ${context.orgId}
    ) SELECT id FROM ancestors`)
  for (const ancestor of ancestors) await context.db.execute(sql`
    WITH RECURSIVE family AS (
      SELECT id FROM post WHERE id = ${ancestor.id} AND org_id = ${context.orgId}
      UNION SELECT p.id FROM post p JOIN family f ON p.merged_to = f.id WHERE p.org_id = ${context.orgId}
    ) UPDATE post SET vote_count = (SELECT count(DISTINCT user_id) FROM vote WHERE post_id IN (SELECT id FROM family)), updated_at = now()
      WHERE id = ${ancestor.id} AND org_id = ${context.orgId}`)
}

export async function setFeedbackVote(context: ContentContext, id: string, voted: boolean) {
  await lockFeedback(context)
  const existing = await feedbackRecord(context, id)
  if (voted && existing.mergedTo) throw contentError(403, 'Cannot vote on merged feedback')
  if (voted) {
    const changed = await context.db.insert(vote).values({ postId: id, userId: context.userId }).onConflictDoNothing().returning()
    if (!changed.length) return { voted, voteCount: existing.voteCount }
    if (!isModerator(context)) await context.db.insert(postSubscription).values({ postId: id, userId: context.userId }).onConflictDoNothing()
  } else {
    const changed = await context.db.delete(vote).where(and(eq(vote.postId, id), eq(vote.userId, context.userId))).returning()
    if (!changed.length) return { voted, voteCount: existing.voteCount }
  }
  await recalculateAncestors(context, id)
  return { voted, voteCount: (await feedbackRecord(context, id)).voteCount }
}
async function removeMergeComment(context: ContentContext, parentId: string, childId: string) {
  const removed = await context.db.delete(comment).where(and(eq(comment.postId, parentId), eq(comment.type, 'mergedPost'), sql`${comment.metadata}->>'merged_post_id' = ${childId}`)).returning()
  if (removed.length) await context.db.update(post).set({ commentCount: sql`greatest(${post.commentCount} - ${removed.length}, 0)` }).where(eq(post.id, parentId))
}
export async function mergeFeedback(context: ContentContext, sourceId: string, targetId: string) {
  requireModerator(context)
  if (sourceId === targetId) throw contentError(400, 'Cannot merge feedback into itself')
  await lockFeedback(context)
  const source = await feedbackRecord(context, sourceId)
  const target = await feedbackRecord(context, targetId)
  if (target.mergedTo) throw contentError(400, 'The target must be a primary feedback')
  if (source.mergedTo === targetId) return { sourceId, targetId, mergedTo: targetId }
  const descendants = await context.db.execute<{ id: string }>(sql`
    WITH RECURSIVE family AS (SELECT id FROM post WHERE id = ${sourceId} AND org_id = ${context.orgId}
      UNION SELECT p.id FROM post p JOIN family f ON p.merged_to = f.id WHERE p.org_id = ${context.orgId}) SELECT id FROM family WHERE id = ${targetId}`)
  if (descendants.length) throw contentError(400, 'A merge cannot create a cycle')
  await context.db.update(post).set({ mergedTo: targetId }).where(eq(post.id, sourceId))
  if (source.mergedTo) {
    await removeMergeComment(context, source.mergedTo, sourceId)
    await recalculateAncestors(context, source.mergedTo)
  }
  await recalculateAncestors(context, targetId)
  await context.db.insert(comment).values({ postId: targetId, authorId: context.userId, content: '', type: 'mergedPost', metadata: { merged_post_id: sourceId } })
  await context.db.update(post).set({ commentCount: sql`${post.commentCount} + 1` }).where(eq(post.id, targetId))
  return { sourceId, targetId, previousPrimaryId: source.mergedTo, mergedTo: targetId }
}
export async function unmergeFeedback(context: ContentContext, id: string) {
  requireModerator(context)
  await lockFeedback(context)
  const existing = await feedbackRecord(context, id)
  if (!existing.mergedTo) throw contentError(400, 'Feedback is not merged')
  await context.db.update(post).set({ mergedTo: null }).where(eq(post.id, id))
  await removeMergeComment(context, existing.mergedTo, id)
  await recalculateAncestors(context, existing.mergedTo)
  await recalculateAncestors(context, id)
  return { id, previousPrimaryId: existing.mergedTo, mergedTo: null }
}
