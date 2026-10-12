import { sql } from 'drizzle-orm'
import { verification } from '../db/schemas'

export interface McpAuthorizationRequest {
  userId: string
  sessionId: string
  clientId: string
  codeChallenge: string
  oauthQuery: string
  referenceId: string
  consentId: string | null
  initialOrganizationIds: string[]
  consumedAt: string | null
}

// Other verification namespaces contain plain text; SQL predicate evaluation order is not guaranteed.
export const mcpRequestData = sql`(CASE WHEN ${verification.identifier} LIKE 'mcp-request:%' THEN ${verification.value}::jsonb END)`
