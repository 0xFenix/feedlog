import { createMcpHandler } from '@modelcontextprotocol/server'
import { requireMcpOrigin } from '../mcp/config'
import { mcpChallenge, verifyMcpRequest } from '../mcp/authorization'
import { createFeedLogMcpServer } from '../mcp/tools'

export default defineEventHandler(async event => {
  const config = requireMcpOrigin(event)
  const request = toWebRequest(event)
  const origin = request.headers.get('origin')
  if (origin && origin !== config.origin) throw createError({ statusCode: 403, message: 'Origin is not allowed' })
  if (event.method !== 'POST') {
    setHeader(event, 'Allow', 'POST')
    throw createError({ statusCode: 405, message: 'Method not allowed' })
  }
  let identity
  try { identity = await verifyMcpRequest(request, config) }
  catch (error) { return mcpChallenge(error, config.resource) }
  return createMcpHandler(() => createFeedLogMcpServer(event, identity, config.origin), { legacy: 'stateless' }).fetch(request)
})
