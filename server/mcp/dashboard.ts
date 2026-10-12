import { createError, getRequestURL, setHeader, type H3Event } from 'h3'
import { auth } from '../utils/better-auth'
import { mcpConfig, mcpEnabled, requireMcpSameOrigin } from './config'
import { eligibleOrganizations } from './grants'

export async function requireMcpSession(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (!mcpEnabled()) throw createError({ statusCode: 404, message: 'MCP is unavailable' })
  if (!['GET', 'HEAD'].includes(event.method)) requireMcpSameOrigin(event)
  const session = await auth.api.getSession({ headers: event.headers, query: { disableCookieCache: true } })
  if (!session) throw createError({ statusCode: 401, message: 'Authentication required' })
  if ((session.session as { ssoOrgId?: string | null }).ssoOrgId || (session.user as { isAnonymous?: boolean; banned?: boolean }).isAnonymous || (session.user as { banned?: boolean }).banned) {
    throw createError({ statusCode: 403, message: 'Sign in directly to manage application access', data: { code: 'LOCAL_AUTH_REQUIRED' } })
  }
  return session
}

export async function requireMcpDashboard(event: H3Event) {
  const session = await requireMcpSession(event)
  const organizations = await eligibleOrganizations(session.user.id)
  const organization = organizations.find(org => org.id === event.context.orgId)
  if (!organization) throw createError({ statusCode: 403, message: 'Organization membership is required' })
  return { session, organization, config: mcpConfig(getRequestURL(event, { xForwardedHost: false }).origin) }
}
