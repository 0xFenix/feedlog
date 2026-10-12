export interface McpApplication {
  id: string
  client: { id: string; name: string; type: string }
  authorizedBy: { id: string; name: string; image: string | null }
  isOwn: boolean
  authorizedAt: string
  lastUsedAt: string | null
  actions: { manageOrganizations: boolean; revokeOrganization: boolean; disconnect: boolean }
}
export interface McpConnections {
  serverUrl: string
  organization: { id: string; name: string }
  items: McpApplication[]
  pagination: { page: number; pageSize: number; total: number }
}
export interface McpConnectionOrganizations {
  connectionId: string
  client: { id: string; name: string; type: string }
  organizations: { id: string; name: string; role: string; authorized: boolean }[]
}
export interface McpConsentContext {
  authorizationRequestId: string
  expiresAt: string
  client: { id: string; name: string; type: string }
  user: { id: string; name: string; email: string }
  organizations: { id: string; name: string; role: string }[]
  selectedOrganizationIds: string[]
}
