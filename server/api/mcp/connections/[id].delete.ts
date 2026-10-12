import { requireMcpSession } from '../../../mcp/dashboard'
import { changeConnection } from '../../../mcp/management'
import { mcpError, revokeGrant } from '../../../mcp/grants'

export default defineEventHandler(async event => {
  const session = await requireMcpSession(event)
  await changeConnection(getRouterParam(event, 'id')!, async (database, consent) => {
    if (consent.userId !== session.user.id) throw mcpError(403, 'FORBIDDEN', 'Only the authorizing person can disconnect this application')
    await revokeGrant(database, consent, session.user.id)
  })
  setResponseStatus(event, 204)
})
