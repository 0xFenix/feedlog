import { requireMcpSession } from '../../../../mcp/dashboard'
import { ownConnection } from '../../../../mcp/management'
import { eligibleOrganizations, grantOrganizations } from '../../../../mcp/grants'
import { mcpClientDisplay } from '../../../../../shared/utils/mcp-client'

export default defineEventHandler(async event => {
  const session = await requireMcpSession(event)
  const id = getRouterParam(event, 'id')!
  const grant = await ownConnection(id, session.user.id)
  const organizations = await eligibleOrganizations(session.user.id)
  const authorized = await grantOrganizations(id, session.user.id)
  return { connectionId: id, client: mcpClientDisplay(grant.client.clientId, grant.client.name),
    organizations: organizations.map(({ id, name, role }) => ({ id, name, role, authorized: authorized.some(org => org.id === id) })) }
})
