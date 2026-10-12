import { z } from 'zod'
import { requireMcpOrigin } from '../../mcp/config'
import { requireMcpSession } from '../../mcp/dashboard'
import { consentContext } from '../../mcp/consent'

export default defineEventHandler(async event => {
  const config = requireMcpOrigin(event)
  const session = await requireMcpSession(event)
  const { oauth_query } = await getValidatedQuery(event, z.object({ oauth_query: z.string().min(1).max(16000) }).parse)
  return consentContext(config, session, event.headers, oauth_query)
})
