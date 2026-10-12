import { z } from 'zod'
import { requireMcpSession } from '../../../../mcp/dashboard'
import { changeConnection } from '../../../../mcp/management'
import { mcpError, updateGrantOrganizations } from '../../../../mcp/grants'

const input = z.strictObject({
  addOrganizationIds: z.array(z.string().min(1)).max(1000).default([]),
  removeOrganizationIds: z.array(z.string().min(1)).max(1000).default([]),
}).refine(value => !value.addOrganizationIds.some(id => value.removeOrganizationIds.includes(id)), 'An organization cannot be both added and removed')

export default defineEventHandler(async event => {
  const session = await requireMcpSession(event)
  const body = await readValidatedBody(event, input.parse)
  return changeConnection(getRouterParam(event, 'id')!, async (database, consent) => {
    if (consent.userId !== session.user.id) throw mcpError(403, 'FORBIDDEN', 'Only the authorizing person can manage this connection')
    return updateGrantOrganizations(database, consent, session.user.id, [...new Set(body.addOrganizationIds)], [...new Set(body.removeOrganizationIds)])
  })
})
