import { z } from 'zod'
import { mcpError } from './grants'

const schema = z.strictObject({ v: z.literal(1), filter: z.string(), key: z.union([z.iso.datetime(), z.number().int()]), id: z.uuid() })
export async function cursorFilter(value: unknown) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}
export function decodeCursor(value: string | undefined, filter: string) {
  if (!value) return null
  try {
    const parsed = schema.parse(JSON.parse(atob(value)))
    if (parsed.filter !== filter) throw new Error('Filter mismatch')
    return parsed
  }
  catch { throw mcpError(400, 'INVALID_CURSOR', 'This cursor is invalid for the current filters. Restart the list.') }
}
export function encodeCursor(filter: string, key: string | number, id: string) {
  return btoa(JSON.stringify({ v: 1, filter, key, id }))
}
