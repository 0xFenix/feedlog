import { db } from '../db'
import { activeGrant, grantOrganizations, lockMcpGrant, mcpError, type McpDatabase, type McpGrant } from './grants'

export async function ownConnection(id: string, userId: string, database: McpDatabase = db) {
  const grant = await activeGrant(id, database)
  if (!grant || !(await grantOrganizations(id, grant.consent.userId!, database)).length) throw mcpError(404, 'CONNECTION_NOT_FOUND', 'Connection not found')
  if (grant.consent.userId !== userId) throw mcpError(403, 'FORBIDDEN', 'Only the authorizing person can manage this connection')
  return grant
}

export async function changeConnection<T>(id: string, operation: (database: McpDatabase, consent: McpGrant) => Promise<T>) {
  const grant = await activeGrant(id)
  if (!grant) throw mcpError(404, 'CONNECTION_NOT_FOUND', 'Connection not found')
  return db.transaction(async tx => {
    await lockMcpGrant(tx, grant.consent.userId!, grant.consent.clientId)
    const current = await activeGrant(id, tx, true)
    if (!current || !(await grantOrganizations(id, current.consent.userId!, tx)).length) throw mcpError(404, 'CONNECTION_NOT_FOUND', 'Connection not found')
    return operation(tx, current.consent)
  })
}
