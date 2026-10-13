import { and, eq, ilike, or, sql } from 'drizzle-orm'
import { board, post, user } from '../db/schemas'
import { postFilterConditions } from '../utils/postFilterConditions'
import { contentError, type ContentReader } from './content-context'
import { cursorPage, literalSubstring, type CursorPageInput } from './query-pagination'

export const feedbackSummaryFields = {
  id: post.id, orgId: post.orgId, boardId: post.boardId, authorId: post.authorId,
  slug: post.slug, status: post.status, title: post.title, excerpt: post.excerpt,
  voteCount: post.voteCount, commentCount: post.commentCount, mergedTo: post.mergedTo,
  createdAt: post.createdAt, updatedAt: post.updatedAt,
}
export interface FeedbackListInput extends CursorPageInput {
  query?: string; boardId?: string | null; status?: string; includeMerged?: boolean
  createdFrom?: string; createdTo?: string; updatedFrom?: string; updatedTo?: string
  sort?: 'created_desc' | 'created_asc' | 'updated_desc' | 'votes_desc'
}
export async function listFeedback(context: ContentReader, input: FeedbackListInput) {
  const conditions = postFilterConditions({
    orgId: context.orgId, merged: input.includeMerged ? 'all' : 'canonical_only',
    status: input.status ? [input.status] : undefined,
    boardId: input.boardId === undefined ? undefined : [input.boardId ?? 'none'],
  })
  if (input.query) conditions.push(or(ilike(post.title, literalSubstring(input.query)), ilike(post.content, literalSubstring(input.query)))!)
  for (const [from, to, column] of [[input.createdFrom, input.createdTo, post.createdAt], [input.updatedFrom, input.updatedTo, post.updatedAt]] as const) {
    if (from && to && from >= to) throw contentError(400, 'The end of a time range must be after its start')
    if (from) conditions.push(sql`${column} >= ${from}::timestamptz`)
    if (to) conditions.push(sql`${column} < ${to}::timestamptz`)
  }
  const filter = { query: input.query, board_id: input.boardId, status: input.status, include_merged: input.includeMerged, created_from: input.createdFrom, created_to: input.createdTo, updated_from: input.updatedFrom, updated_to: input.updatedTo, sort: input.sort }
  const sort = input.sort === 'votes_desc' ? 'vote_count' : input.sort === 'updated_desc' ? 'updated_at' : 'created_at'
  const column = input.sort === 'votes_desc' ? post.voteCount : input.sort === 'updated_desc' ? post.updatedAt : post.createdAt
  const page = await cursorPage(input, { kind: 'feedback', organizationId: context.orgId, filter, sort, ascending: input.sort === 'created_asc' }, column, post.id, input.sort === 'created_asc', input.sort === 'votes_desc')
  const rows = await context.db.select({ ...feedbackSummaryFields, cursorKey: page.cursorKey }).from(post)
    .where(and(...conditions, page.after)).orderBy(...page.orderBy).limit(input.limit + 1)
  return page.finish(rows)
}
export async function getFeedbackRecord(context: ContentReader, id: string) {
  const [record] = await context.db.select({
    ...feedbackSummaryFields, content: post.content,
    author: { id: user.id, name: user.name, image: user.image },
    board: { id: board.id, name: board.name },
  }).from(post).leftJoin(user, eq(user.id, post.authorId))
    .leftJoin(board, and(eq(board.id, post.boardId), eq(board.orgId, context.orgId)))
    .where(and(eq(post.id, id), eq(post.orgId, context.orgId)))
  if (!record) throw contentError(404, 'Feedback not found')
  return record
}
