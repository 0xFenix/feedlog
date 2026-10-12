import { and, eq, gt, like, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { uuidv7 } from 'uuidv7'
import { db } from '../db'
import { oauthClient, oauthConsent, verification } from '../db/schemas'
import { getMcpAuth } from '../utils/better-auth'
import { mcpClientDisplay } from '../../shared/utils/mcp-client'
import { mcpRequestData, type McpAuthorizationRequest } from './authorization-request'
import type { mcpConfig } from './config'
import { MCP_SCOPES } from './config'
import { auditGrant, eligibleOrganizations, grantOrganizations, lockMcpGrant, mcpError, revokeGrant, updateGrantOrganizations } from './grants'

type Config = ReturnType<typeof mcpConfig>
type Session = { user: { id: string; name: string; email: string }; session: { id: string } }
const expired = () => mcpError(400, 'AUTHORIZATION_REQUEST_EXPIRED', 'The authorization request expired. Start again.')
const changed = () => mcpError(409, 'AUTHORIZATION_CHANGED', 'Authorization changed. Reload the organizations before continuing.')
const sameIds = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

export async function consentContext(config: Config, session: Session, headers: Headers, oauthQuery: string) {
  const params = new URLSearchParams(oauthQuery)
  const clientId = params.get('client_id') ?? ''
  const codeChallenge = params.get('code_challenge') ?? ''
  const provider = getMcpAuth(config)
  try {
    await provider.api.getOAuthClientPublicPrelogin({ headers, body: { client_id: clientId, oauth_query: oauthQuery } })
  }
  catch { throw expired() }
  const scopes = (params.get('scope') ?? '').split(' ').filter(Boolean)
  if (!codeChallenge || params.get('code_challenge_method') !== 'S256'
    || !scopes.includes('mcp:access') || scopes.some(scope => !MCP_SCOPES.includes(scope))
    || !params.getAll('resource').includes(config.resource)) throw expired()
  const expiresAt = new Date(Math.min(Date.now() + 600_000, Number(params.get('exp')) * 1000))
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) throw expired()
  const [client] = await db.select().from(oauthClient).where(eq(oauthClient.clientId, clientId))
  if (!client || client.disabled) throw expired()
  const organizations = await eligibleOrganizations(session.user.id)
  if (!organizations.length) throw mcpError(403, 'FORBIDDEN', 'Organization membership is required')
  const request = await db.transaction(async tx => {
    await lockMcpGrant(tx, session.user.id, clientId)
    await tx.delete(verification).where(and(like(verification.identifier, 'mcp-request:%'), lt(verification.expiresAt, new Date())))
    const [existing] = await tx.select().from(verification).where(and(like(verification.identifier, 'mcp-request:%'),
      sql`${mcpRequestData} ->> 'userId' = ${session.user.id}`,
      sql`${mcpRequestData} ->> 'clientId' = ${clientId}`,
      sql`${mcpRequestData} ->> 'codeChallenge' = ${codeChallenge}`))
    if (existing) {
      const value = JSON.parse(existing.value) as McpAuthorizationRequest
      if (value.consumedAt) throw expired()
      if (value.sessionId === session.session.id && value.oauthQuery === oauthQuery) return existing
      await tx.delete(verification).where(eq(verification.id, existing.id))
    }
    let [consent] = await tx.select().from(oauthConsent).where(and(eq(oauthConsent.userId, session.user.id), eq(oauthConsent.clientId, clientId), like(oauthConsent.referenceId, 'mcp:%')))
    const authorized = consent ? await grantOrganizations(consent.id, session.user.id, tx) : []
    if (consent && !authorized.length) {
      await revokeGrant(tx, consent, session.user.id)
      consent = undefined!
    }
    const value: McpAuthorizationRequest = {
      userId: session.user.id, sessionId: session.session.id, clientId, codeChallenge, oauthQuery,
      referenceId: consent?.referenceId ?? `mcp:${uuidv7()}`, consentId: consent?.id ?? null,
      initialOrganizationIds: authorized.map(org => org.id), consumedAt: null,
    }
    const id = crypto.randomUUID()
    const [created] = await tx.insert(verification).values({ id: uuidv7(), identifier: `mcp-request:${id}`, expiresAt, value: JSON.stringify(value) }).returning()
    return created!
  })
  const value = JSON.parse(request.value) as McpAuthorizationRequest
  return {
    authorizationRequestId: request.identifier.slice('mcp-request:'.length),
    expiresAt: request.expiresAt.toISOString(),
    client: mcpClientDisplay(clientId, client.name),
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    organizations: organizations.map(({ id, name, role }) => ({ id, name, role })),
    selectedOrganizationIds: value.initialOrganizationIds,
  }
}

export const consentInput = z.strictObject({
  authorizationRequestId: z.uuid(),
  expectedUserId: z.string().min(1),
  accept: z.boolean(),
  organizationIds: z.array(z.string().min(1)).max(1000).default([]),
}).refine(value => !value.accept || value.organizationIds.length > 0, 'Select at least one organization')

export async function submitConsent(config: Config, session: Session, headers: Headers, input: z.infer<typeof consentInput>) {
  if (input.expectedUserId !== session.user.id) throw mcpError(409, 'ACCOUNT_CHANGED', 'The signed-in account changed. Reload the authorization request.')
  const identifier = `mcp-request:${input.authorizationRequestId}`
  // Commit consumption before the provider's independent adapter invokes our callbacks.
  const [row] = await db.update(verification).set({ value: sql`jsonb_set(${verification.value}::jsonb, '{consumedAt}', to_jsonb(${new Date().toISOString()}::text))::text` })
    .where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, new Date()),
      sql`${mcpRequestData} ->> 'userId' = ${session.user.id}`,
      sql`${mcpRequestData} ->> 'sessionId' = ${session.session.id}`,
      sql`${mcpRequestData} ->> 'consumedAt' IS NULL`)).returning()
  if (!row) throw expired()
  const context = JSON.parse(row.value) as McpAuthorizationRequest
  try {
    return await db.transaction(async tx => {
      await lockMcpGrant(tx, session.user.id, context.clientId)
      const [current] = await tx.select().from(oauthConsent).where(and(eq(oauthConsent.userId, session.user.id), eq(oauthConsent.clientId, context.clientId), like(oauthConsent.referenceId, 'mcp:%')))
      if ((current?.id ?? null) !== context.consentId || (current && current.referenceId !== context.referenceId)) throw changed()
      const authorized = current ? await grantOrganizations(current.id, session.user.id, tx) : []
      if (!sameIds(authorized.map(org => org.id), context.initialOrganizationIds)) throw changed()
      const selected = [...new Set(input.organizationIds)]
      const eligible = await eligibleOrganizations(session.user.id, tx)
      if (input.accept && selected.some(id => !eligible.some(org => org.id === id))) throw mcpError(403, 'FORBIDDEN', 'Organization membership is required')
      const response = await getMcpAuth(config).api.oauth2Consent({
        headers,
        request: new Request(`${config.origin}/api/auth/oauth2/consent`, { method: 'POST', headers }),
        asResponse: false,
        body: { accept: input.accept, oauth_query: context.oauthQuery },
      })
      if (!response?.url) throw expired()
      const redirect = new URL(response.url)
      if (input.accept) {
        // Never expose a code until its organizations and audit have committed.
        if (!redirect.searchParams.has('code')) throw expired()
        const [consent] = await tx.select().from(oauthConsent).where(and(eq(oauthConsent.userId, session.user.id), eq(oauthConsent.referenceId, context.referenceId))).for('update')
        if (!consent) throw expired()
        if (!current) await auditGrant(tx, consent, session.user.id, 'authorization.create')
        await updateGrantOrganizations(tx, consent, session.user.id, selected, authorized.filter(org => !selected.includes(org.id)).map(org => org.id))
      }
      return { redirectUrl: response.url }
    })
  }
  catch (error) {
    // Provider writes are outside the transaction. A failed first consent must leave no reusable grant.
    if (!context.consentId) await db.transaction(async tx => {
      await lockMcpGrant(tx, session.user.id, context.clientId)
      const [created] = await tx.select().from(oauthConsent).where(and(eq(oauthConsent.userId, session.user.id), eq(oauthConsent.referenceId, context.referenceId)))
      if (created) await revokeGrant(tx, created, session.user.id)
    })
    throw error
  }
  finally {
    await db.delete(verification).where(eq(verification.id, row.id))
  }
}
