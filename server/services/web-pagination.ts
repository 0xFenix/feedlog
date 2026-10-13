/** Existing Web API cursor wire format; MCP uses filter-bound cursors instead. */
export function encodeWebCursor(data: { s: unknown; id: string }): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url')
}
export function decodeWebCursor(cursor: string): { s: string | number; id: string } | null {
  try { return JSON.parse(Buffer.from(cursor, 'base64url').toString()) }
  catch { return null }
}
