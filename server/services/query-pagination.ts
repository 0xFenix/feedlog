import { asc, desc, sql, type SQLWrapper } from 'drizzle-orm'
import { z } from 'zod'
import { createError } from 'h3'

export interface CursorPageInput { limit: number; cursor?: string }
const cursorSchema = z.strictObject({ v: z.literal(1), filter: z.string(), key: z.union([z.iso.datetime(), z.number().int()]), id: z.uuid() })
function invalidCursor() {
  return createError({ statusCode: 400, message: 'This cursor is invalid for the current filters. Restart the list.', data: { code: 'INVALID_CURSOR' } })
}

/** Keep timestamp cursor keys at database precision; response Dates may use milliseconds. */
export function timestampCursorKey(column: SQLWrapper) {
  return sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
}
export async function cursorPage(input: CursorPageInput, scope: unknown, column: SQLWrapper, id: SQLWrapper, ascending = false, numeric = false) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(scope)))
  const fingerprint = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
  let after
  if (input.cursor) {
    try {
      const cursor = cursorSchema.parse(JSON.parse(atob(input.cursor)))
      if (cursor.filter !== fingerprint || numeric !== (typeof cursor.key === 'number')) throw invalidCursor()
      after = sql`(${column}, ${id}) ${sql.raw(ascending ? '>' : '<')} (${cursor.key}${sql.raw(numeric ? '::integer' : '::timestamptz')}, ${cursor.id}::uuid)`
    } catch { throw invalidCursor() }
  }
  const order = ascending ? asc : desc
  return {
    after,
    orderBy: [order(column), order(id)],
    cursorKey: numeric ? sql<number>`${column}` : timestampCursorKey(column),
    finish<T extends { id: string; cursorKey: string | number }>(rows: T[]) {
      const items = rows.slice(0, input.limit)
      const last = items.at(-1)
      return {
        items: items.map(({ cursorKey: _key, ...item }) => item),
        nextCursor: rows.length > input.limit && last ? btoa(JSON.stringify({ v: 1, filter: fingerprint, key: last.cursorKey, id: last.id })) : null,
      }
    },
  }
}
export function literalSubstring(query: string) { return '%' + query.replace(/[\\%_]/g, '\\$&') + '%' }
