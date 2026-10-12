import { createError, getRequestURL, type H3Event } from 'h3'

export const MCP_SCOPES = ['mcp:access', 'offline_access']
export const MCP_STAFF_ROLES = ['owner', 'manager', 'contributor']

export function mcpEnabled() {
  return process.env.MCP_ENABLED !== 'false'
}

export function mcpConfig(requestOrigin: string) {
  const configured = process.env.AUTH_DOMAIN || process.env.BETTER_AUTH_URL || requestOrigin
  const url = new URL(configured)
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('The MCP origin must not include a path, query, fragment or credentials')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('MCP requires HTTPS, except on localhost')
  }
  return { origin: url.origin, issuer: `${url.origin}/api/auth`, resource: `${url.origin}/api/mcp` }
}

export function requireMcpOrigin(event: H3Event) {
  const origin = getRequestURL(event, { xForwardedHost: false }).origin
  const config = mcpConfig(origin)
  if (!mcpEnabled() || origin !== config.origin) {
    throw createError({ statusCode: 404, message: 'MCP is unavailable on this host' })
  }
  return config
}

export function requireMcpSameOrigin(event: H3Event) {
  const origin = getRequestURL(event, { xForwardedHost: false }).origin
  if (event.headers.get('origin') !== origin) {
    throw createError({ statusCode: 403, message: 'A same-origin request is required' })
  }
}
