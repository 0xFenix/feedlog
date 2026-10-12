import { requireMcpDashboard } from '../../../../../mcp/dashboard'
import { changeConnection } from '../../../../../mcp/management'
import { grantOrganizations, mcpError, updateGrantOrganizations } from '../../../../../mcp/grants'
import { and, eq, inArray } from 'drizzle-orm'
import { member } from '../../../../../db/schemas'

export default defineEventHandler(async event => {
  const { session, organization } = await requireMcpDashboard(event)
  if (getRouterParam(event, 'orgId') !== organization.id) throw mcpError(403, 'FORBIDDEN', 'Only the current organization can be revoked here')
  return changeConnection(getRouterParam(event, 'id')!, async (database, consent) => {
    const authorized = await grantOrganizations(consent.id, consent.userId!, database)
    if (!authorized.some(org => org.id === organization.id)) throw mcpError(404, 'CONNECTION_NOT_FOUND', 'Connection not found')
    if (consent.userId !== session.user.id) {
      const [administrator] = await database.select({ id: member.id }).from(member)
        .where(and(eq(member.userId, session.user.id), eq(member.organizationId, organization.id), inArray(member.role, ['owner', 'manager']))).for('share')
      if (!administrator) throw mcpError(403, 'FORBIDDEN', 'Organization administrator access is required')
    }
    const result = await updateGrantOrganizations(database, consent, session.user.id, [], [organization.id])
    return { connectionId: consent.id, disconnected: result.disconnected }
  })
})
