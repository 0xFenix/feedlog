import { sql, type SQL } from 'drizzle-orm'
import { buildPostLink } from '../utils/post-link-builder'
import { contentError, type ContentContext } from '../services/content-context'
import { feedbackRecord } from '../services/feedback'
import { cursorFilter, decodeCursor, encodeCursor } from './cursor'
import { mcpError } from './grants'

export interface ListInput {
  limit: number
  cursor?: string
  query?: string
  status?: string
  board_id?: string | null
  collection_id?: string
  ai_enabled?: boolean
  visible?: boolean
  feedback_id?: string
  include_merged?: boolean
  created_from?: string
  created_to?: string
  updated_from?: string
  updated_to?: string
  sort?: 'created_desc' | 'created_asc' | 'updated_desc' | 'votes_desc'
}
const tables = { feedback: 'post', comments: 'comment', boards: 'board', collections: 'help_collection', articles: 'help_article', changelogs: 'changelog' } as const
export type ListKind = keyof typeof tables
export async function listRecords(context: ContentContext, kind: ListKind, input: ListInput) {
  const ascending = kind === 'boards' || kind === 'collections' || input.sort === 'created_asc'
  const sort = kind === 'boards' || kind === 'collections' ? 'position'
    : input.sort === 'votes_desc' ? 'vote_count' : input.sort === 'updated_desc' ? 'updated_at' : 'created_at'
  const numeric = sort === 'position' || sort === 'vote_count'
  const column = sql.raw('t.' + sort)
  const conditions: SQL[] = []
  if (kind === 'comments') {
    await feedbackRecord(context, input.feedback_id!)
    conditions.push(sql`t.post_id = ${input.feedback_id}`)
  } else conditions.push(sql`t.org_id = ${context.orgId}`)
  if (kind === 'feedback' && !input.include_merged) conditions.push(sql`t.merged_to IS NULL`)
  if (input.status) conditions.push(sql`t.status = ${input.status}`)
  if (input.board_id !== undefined) conditions.push(input.board_id === null ? sql`t.board_id IS NULL` : sql`t.board_id = ${input.board_id}`)
  if (input.collection_id) conditions.push(sql`t.collection_id = ${input.collection_id}`)
  if (input.ai_enabled !== undefined) conditions.push(sql`t.ai_enabled = ${input.ai_enabled}`)
  if (input.visible !== undefined) conditions.push(sql`t.visible = ${input.visible}`)
  if (input.query) {
    // Literal substring search includes title and body; it does not claim semantic ranking.
    const query = input.query.replace(/[\\%_]/g, '\\$&')
    conditions.push(sql`(t.title ILIKE ${'%' + query + '%'} OR t.content ILIKE ${'%' + query + '%'})`)
  }
  for (const [key, columnName, operation] of [
    ['created_from', 'created_at', '>='], ['created_to', 'created_at', '<'],
    ['updated_from', 'updated_at', '>='], ['updated_to', 'updated_at', '<'],
  ] as const) {
    if (input[key]) conditions.push(sql`${sql.raw('t.' + columnName)} ${sql.raw(operation)} ${input[key]}::timestamptz`)
  }
  if ((input.created_from && input.created_to && input.created_from >= input.created_to)
    || (input.updated_from && input.updated_to && input.updated_from >= input.updated_to)) throw contentError(400, 'The end of a time range must be after its start')
  const { cursor: _cursor, limit: _limit, ...filter } = input
  const fingerprint = await cursorFilter({ kind, organizationId: context.orgId, filter, sort, ascending })
  const cursor = decodeCursor(input.cursor, fingerprint)
  if (cursor) {
    if (numeric !== (typeof cursor.key === 'number')) throw mcpError(400, 'INVALID_CURSOR', 'Cursor sort value is invalid')
    const operation = sql.raw(ascending ? '>' : '<')
    const cast = sql.raw(numeric ? '::integer' : '::timestamptz')
    conditions.push(sql`(${column}, t.id) ${operation} (${cursor.key}${cast}, ${cursor.id}::uuid)`)
  }
  const key = numeric ? column : sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
  const direction = sql.raw(ascending ? 'ASC' : 'DESC')
  let value: SQL = sql`to_jsonb(t) - 'content' - 'tsv' - 'content_hash' - 'published_content'`
  if (kind === 'comments') value = sql`to_jsonb(t) || jsonb_build_object('author', (SELECT jsonb_build_object('id', u.id, 'name', u.name, 'image', u.image) FROM "user" u WHERE u.id = t.author_id))`
  if (kind === 'boards') value = sql`to_jsonb(t) || jsonb_build_object('feedback_count', (SELECT count(*) FROM post p WHERE p.org_id = t.org_id AND p.board_id = t.id AND p.merged_to IS NULL))`
  if (kind === 'collections') value = sql`to_jsonb(t) || jsonb_build_object('article_count', (SELECT count(*) FROM help_article a WHERE a.org_id = t.org_id AND a.collection_id = t.id))`
  const rows = await context.db.execute<{ value: Record<string, unknown>; key: string | number; id: string }>(sql`
    SELECT ${value} AS value, ${key} AS key, t.id FROM ${sql.identifier(tables[kind])} t
    WHERE ${sql.join(conditions, sql` AND `)} ORDER BY ${column} ${direction}, t.id ${direction} LIMIT ${input.limit + 1}`)
  const records = rows.slice(0, input.limit)
  const last = records.at(-1)
  return { items: records.map(row => row.value), next_cursor: rows.length > input.limit && last ? encodeCursor(fingerprint, last.key, last.id) : null }
}
export function recordLink(context: ContentContext, orgSlug: string, kind: 'feedback' | 'article' | 'changelog', record: { slug: string; shortId?: string }) {
  const path = kind === 'feedback' ? `/p/${record.slug}` : kind === 'article' ? `/help/${record.shortId}-${record.slug}` : `/changelog/${record.slug}`
  return buildPostLink(orgSlug, path, context.origin)
}
export function toolRecord(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(toolRecord)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const field = key.replace(/[A-Z]/g, char => '_' + char.toLowerCase())
    const names: Record<string, string> = { org_id: 'organization_id', post_id: 'feedback_id', merged_post_id: 'merged_feedback_id' }
    return [names[field] ?? field, field === 'type' && child === 'mergedPost' ? 'feedback_merged' : toolRecord(child)]
  }))
  return value
}
