import { requireMcpOrigin } from '../../mcp/config'
import { requireMcpSession } from '../../mcp/dashboard'
import { consentInput, submitConsent } from '../../mcp/consent'

export default defineEventHandler(async event => {
  const config = requireMcpOrigin(event)
  const session = await requireMcpSession(event)
  return submitConsent(config, session, event.headers, await readValidatedBody(event, consentInput.parse))
})
