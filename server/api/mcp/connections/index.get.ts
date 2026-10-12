import { and, desc, eq, inArray, like, sql } from 'drizzle-orm'
import { z } from 'zod'
import { mcpConsentOrganization, member, oauthClient, oauthConsent, user } from '../../../db/schemas'
import { requireMcpDashboard } from '../../../mcp/dashboard'
import { MCP_STAFF_ROLES } from '../../../mcp/config'
import { mcpClientDisplay } from '../../../../shared/utils/mcp-client'

export default defineEventHandler(async event => {
  const { config, session, organization } = await requireMcpDashboard(event)
  const { page, pageSize } = await getValidatedQuery(event, z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).parse)
  const condition = and(eq(mcpConsentOrganization.organizationId, organization.id), like(oauthConsent.referenceId, 'mcp:%'), inArray(member.role, MCP_STAFF_ROLES), sql`${user.isAnonymous} IS NOT TRUE`, sql`${user.banned} IS NOT TRUE`, sql`${oauthClient.disabled} IS NOT TRUE`)
  const query = () => useDB().select({
    id: oauthConsent.id, clientId: oauthClient.clientId, name: oauthClient.name,
    authorizedBy: { id: user.id, name: user.name, image: user.image },
    authorizedAt: mcpConsentOrganization.authorizedAt, lastUsedAt: mcpConsentOrganization.lastUsedAt,
    total: sql<number>`count(*) OVER()::int`,
  }).from(mcpConsentOrganization)
    .innerJoin(oauthConsent, eq(oauthConsent.id, mcpConsentOrganization.consentId))
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .innerJoin(user, eq(user.id, oauthConsent.userId))
    .innerJoin(member, and(eq(member.id, mcpConsentOrganization.memberId), eq(member.organizationId, organization.id), eq(member.userId, user.id)))
    .where(condition)
  const rows = await query().orderBy(desc(mcpConsentOrganization.authorizedAt), oauthConsent.id).limit(pageSize).offset((page - 1) * pageSize)
  const total = rows[0]?.total ?? (page > 1 ? (await query().limit(1))[0]?.total ?? 0 : 0)
  return {
    serverUrl: config.resource, organization: { id: organization.id, name: organization.name },
    items: rows.map(row => ({
      id: row.id, client: mcpClientDisplay(row.clientId, row.name), authorizedBy: row.authorizedBy,
      isOwn: row.authorizedBy.id === session.user.id, authorizedAt: row.authorizedAt, lastUsedAt: row.lastUsedAt,
      actions: { manageOrganizations: row.authorizedBy.id === session.user.id, disconnect: row.authorizedBy.id === session.user.id,
        revokeOrganization: row.authorizedBy.id === session.user.id || ['owner', 'manager'].includes(organization.role) },
    })),
    pagination: { page, pageSize, total },
  }
})
