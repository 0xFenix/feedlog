import { mcp } from '@better-auth/mcp'
import { getOAuthProviderState } from '@better-auth/oauth-provider'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth'
import { jwt } from 'better-auth/plugins'
import { and, eq, gt, like, sql } from 'drizzle-orm'
import { db } from '../db'
import { oauthConsent, verification } from '../db/schemas'
import { MCP_SCOPES, type mcpConfig } from './config'
import { activeGrant, eligibleOrganizations, grantOrganizations } from './grants'
import { mcpRequestData, type McpAuthorizationRequest } from './authorization-request'

async function authorizedRequest(userId?: string, sessionId?: string) {
  const state = await getOAuthProviderState()
  const query = new URLSearchParams(state?.query)
  if (!userId || !sessionId || !query.get('client_id') || !query.get('code_challenge')) return null
  const [row] = await db.select().from(verification).where(and(
    like(verification.identifier, 'mcp-request:%'), gt(verification.expiresAt, new Date()),
    sql`${mcpRequestData} ->> 'userId' = ${userId}`,
    sql`${mcpRequestData} ->> 'clientId' = ${query.get('client_id')}`,
    sql`${mcpRequestData} ->> 'codeChallenge' = ${query.get('code_challenge')}`,
  ))
  if (!row) return null
  const value = JSON.parse(row.value) as McpAuthorizationRequest
  return value.sessionId === sessionId && value.consumedAt ? value : null
}

export function mcpAuthPlugins(config: ReturnType<typeof mcpConfig>) {
  const clientCompatibility: BetterAuthPlugin = {
    id: 'feedlog-mcp-client-metadata',
    hooks: { before: [{
      matcher: context => context.path === '/oauth2/register',
      handler: createAuthMiddleware(async context => {
        const body = context.body
        // Older MCP clients omit this OIDC metadata field when registering native loopback callbacks.
        if (body?.application_type === undefined && Array.isArray(body?.redirect_uris) && body.redirect_uris.length) {
          const native = body.redirect_uris.every((value: unknown) => {
            try {
              if (typeof value !== 'string') return false
              const url = new URL(value)
              return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
            } catch { return false }
          })
          if (native) body.application_type = 'native'
        }
      }),
    }] },
  }
  return [
    clientCompatibility,
    jwt({ disableSettingJwtHeader: true, jwt: { issuer: config.issuer } }),
    mcp({
      resource: config.resource,
      loginPage: '/mcp/consent',
      consentPage: '/mcp/consent',
      scopes: MCP_SCOPES,
      grantTypes: ['authorization_code', 'refresh_token'],
      accessTokenExpiresIn: 15 * 60,
      refreshTokenExpiresIn: 30 * 24 * 60 * 60,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      allowPublicClientPrelogin: true,
      clientRegistrationDefaultScopes: MCP_SCOPES,
      clientRegistrationAllowedScopes: MCP_SCOPES,
      clientPrivileges: () => false,
      resourcePrivileges: () => false,
      postLogin: {
        page: '/mcp/consent',
        shouldRedirect: async ({ user, session }) => {
          if (session.ssoOrgId || user.isAnonymous || user.banned || !(await eligibleOrganizations(user.id)).length) {
            throw new APIError('FORBIDDEN', { message: 'Sign in directly as an organization member' })
          }
          return !await authorizedRequest(user.id, session.id)
        },
        consentReferenceId: async ({ user, session }) => {
          const request = await authorizedRequest(user?.id, session?.id)
          if (!request) throw new APIError('FORBIDDEN', { message: 'Organization selection is required' })
          return request.referenceId
        },
      },
      customAccessTokenClaims: async ({ user, referenceId, resources }) => {
        const [consent] = referenceId && user ? await db.select().from(oauthConsent)
          .where(and(eq(oauthConsent.userId, user.id), eq(oauthConsent.referenceId, referenceId))) : []
        if (!consent || !consent.scopes.includes('mcp:access') || !resources?.includes(config.resource) || !consent.resources?.includes(config.resource)
          || !await activeGrant(consent.id) || !(await grantOrganizations(consent.id, user!.id)).length) {
          throw new APIError('FORBIDDEN', { error: 'invalid_grant', message: 'Authorization is no longer available' })
        }
        return { mcp_consent_id: consent.id }
      },
    }),
  ]
}
