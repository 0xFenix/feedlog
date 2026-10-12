import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, uuid, varchar, jsonb, primaryKey, index, check } from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'

// Application services own membership and consent cleanup; audit records outlive them.
export const mcpConsentOrganization = pgTable('mcp_consent_organization', {
  consentId: text('consent_id').notNull(),
  organizationId: text('organization_id').notNull(),
  memberId: text('member_id').notNull(),
  authorizedAt: timestamp('authorized_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
}, t => [
  primaryKey({ columns: [t.consentId, t.organizationId] }),
  index('idx_mcp_consent_org_list').on(t.organizationId, sql`${t.authorizedAt} DESC`, t.consentId),
  index('idx_mcp_consent_org_member').on(t.memberId),
])

export const mcpAuditLog = pgTable('mcp_audit_log', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  organizationId: text('organization_id'),
  actorUserId: text('actor_user_id').notNull(),
  authorizationUserId: text('authorization_user_id').notNull(),
  consentId: text('consent_id').notNull(),
  clientId: text('client_id').notNull(),
  operation: varchar('operation', { length: 64 }).notNull(),
  targetType: varchar('target_type', { length: 32 }),
  targetId: text('target_id'),
  status: varchar('status', { length: 16 }).$type<'success' | 'failure'>().notNull(),
  errorCode: varchar('error_code', { length: 64 }),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('idx_mcp_audit_org_time').on(t.organizationId, sql`${t.createdAt} DESC`, sql`${t.id} DESC`),
  index('idx_mcp_audit_consent_time').on(t.consentId, sql`${t.createdAt} DESC`, sql`${t.id} DESC`),
  check('mcp_audit_status_check', sql`${t.status} IN ('success', 'failure')`),
  check('mcp_audit_error_check', sql`${t.status} <> 'success' OR ${t.errorCode} IS NULL`),
])
