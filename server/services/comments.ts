import { getFeedbackRecord } from './feedback-queries'
import { cursorPage, type CursorPageInput } from './query-pagination'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { comment, commentLike, post, user } from '../db/schemas'
import { contentError, isModerator, requireModerator, type ContentReader, type ContentContext } from './content-context'
import { feedbackRecord } from './feedback'
import { lockFeedback } from './feedback-lock'

export const feedbackCommentSchema = z.object({
  content: z.string().trim().min(1, 'Content is required').max(5000, 'Comment must be 5000 characters or less'),
  parentId: z.uuid().optional(),
  replyToId: z.uuid().optional(),
  notifyVoters: z.boolean().optional(),
})
export async function createComment(context: ContentContext, postId: string, body: z.infer<typeof feedbackCommentSchema>) {
  const input = feedbackCommentSchema.parse(body)
  await lockFeedback(context)
  const feedback = await feedbackRecord(context, postId)
  if (feedback.mergedTo) throw contentError(403, 'Cannot comment on merged feedback')
  let parentId = input.parentId ?? null
  let replyToId = input.replyToId ?? null
  if (parentId) {
    const [parent] = await context.db.select().from(comment).where(and(eq(comment.id, parentId), eq(comment.postId, postId)))
    if (!parent || parent.type !== 'comment') throw contentError(404, 'Parent comment not found')
    if (parent.parentId) { replyToId = parentId; parentId = parent.parentId }
  }
  if (replyToId) {
    const [reply] = await context.db.select().from(comment).where(and(eq(comment.id, replyToId), eq(comment.postId, postId)))
    if (!parentId || !reply || (reply.id !== parentId && reply.parentId !== parentId)) throw contentError(400, 'The reply target must belong to this comment thread')
  }
  const [record] = await context.db.insert(comment).values({ postId, parentId, replyToId, authorId: context.userId, content: input.content }).returning()
  if (parentId) await context.db.update(comment).set({ replyCount: sql`${comment.replyCount} + 1` }).where(eq(comment.id, parentId))
  await context.db.update(post).set({ commentCount: sql`${post.commentCount} + 1` }).where(eq(post.id, postId))
  context.afterCommit.push(() => emitCommentNotifications({
    orgId: context.orgId, postId, snippet: input.content, actorId: context.userId,
    authorIsAdmin: isModerator(context), isTopLevel: !parentId, notifyVoters: input.notifyVoters !== false, requestOrigin: context.origin,
  }))
  if (!isModerator(context)) context.afterCommit.push(() => emitAdminNotification({
    orgId: context.orgId, typeKey: 'post.user_commented', postSlug: feedback.slug, postTitle: feedback.title,
    snippet: input.content, actorId: context.userId, requestOrigin: context.origin,
  }))
  const [author] = await context.db.select({ id: user.id, name: user.name, image: user.image, isAnonymous: user.isAnonymous }).from(user).where(eq(user.id, context.userId))
  return { ...record!, hasLiked: false, author: { ...author!, isAnonymous: !!author?.isAnonymous, isAdmin: isModerator(context) } }
}
async function commentRecord(context: ContentContext, id: string) {
  const [row] = await context.db.select({ comment }).from(comment).innerJoin(post, eq(post.id, comment.postId)).where(and(eq(comment.id, id), eq(post.orgId, context.orgId)))
  if (!row || row.comment.type !== 'comment') throw contentError(404, 'Comment not found')
  return row.comment
}
export async function updateComment(context: ContentContext, id: string, content: string) {
  const input = feedbackCommentSchema.shape.content.parse(content)
  await lockFeedback(context)
  const existing = await commentRecord(context, id)
  if (existing.authorId !== context.userId) throw contentError(403, 'Only the author can edit this comment')
  const [record] = await context.db.update(comment).set({ content: input, editedAt: new Date() }).where(eq(comment.id, id)).returning()
  return record!
}
export async function deleteComment(context: ContentContext, id: string) {
  await lockFeedback(context)
  const existing = await commentRecord(context, id)
  if (existing.authorId !== context.userId) requireModerator(context)
  const rows = await context.db.select({ id: comment.id }).from(comment).where(and(eq(comment.postId, existing.postId), or(eq(comment.id, id), eq(comment.parentId, id))))
  const ids = rows.map(row => row.id)
  await context.db.delete(commentLike).where(inArray(commentLike.commentId, ids))
  await context.db.update(comment).set({ replyToId: null }).where(and(eq(comment.postId, existing.postId), inArray(comment.replyToId, ids)))
  await context.db.delete(comment).where(inArray(comment.id, ids))
  if (existing.parentId) await context.db.update(comment).set({ replyCount: sql`greatest(${comment.replyCount} - ${ids.length}, 0)` }).where(eq(comment.id, existing.parentId))
  await context.db.update(post).set({ commentCount: sql`greatest(${post.commentCount} - ${ids.length}, 0)` }).where(eq(post.id, existing.postId))
  return { id, deleted: true, deletedCount: ids.length }
}

export async function setCommentLike(context: ContentContext, id: string, liked: boolean) {
  await lockFeedback(context)
  const existing = await commentRecord(context, id)
  const changed = liked
    ? await context.db.insert(commentLike).values({ commentId: id, userId: context.userId }).onConflictDoNothing().returning()
    : await context.db.delete(commentLike).where(and(eq(commentLike.commentId, id), eq(commentLike.userId, context.userId))).returning()
  if (!changed.length) return { liked, likeCount: existing.likeCount }
  const [record] = await context.db.update(comment).set({ likeCount: sql`(SELECT count(*)::int FROM ${commentLike} WHERE ${commentLike.commentId} = ${id})` }).where(eq(comment.id, id)).returning()
  return { liked, likeCount: record!.likeCount }
}

export const commentFields = {
  id: comment.id, postId: comment.postId, parentId: comment.parentId, replyToId: comment.replyToId,
  replyCount: comment.replyCount, likeCount: comment.likeCount, authorId: comment.authorId,
  content: comment.content, type: comment.type, metadata: comment.metadata,
  editedAt: comment.editedAt, createdAt: comment.createdAt, updatedAt: comment.updatedAt,
}
export async function listComments(context: ContentReader, input: CursorPageInput & { feedbackId: string; sort?: 'created_desc' | 'created_asc' }) {
  await getFeedbackRecord(context, input.feedbackId)
  const page = await cursorPage(input, { kind: 'comments', organizationId: context.orgId, filter: { feedback_id: input.feedbackId, sort: input.sort }, sort: 'created_at', ascending: input.sort === 'created_asc' }, comment.createdAt, comment.id, input.sort !== 'created_desc')
  const rows = await context.db.select({ ...commentFields, author: { id: user.id, name: user.name, image: user.image }, cursorKey: page.cursorKey })
    .from(comment).leftJoin(user, eq(user.id, comment.authorId))
    .where(and(eq(comment.postId, input.feedbackId), page.after)).orderBy(...page.orderBy).limit(input.limit + 1)
  return page.finish(rows)
}
