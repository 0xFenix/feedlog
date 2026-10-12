import { requireMcpOrigin } from '../../mcp/config'

export default defineEventHandler(event => {
  return getMcpAuth(requireMcpOrigin(event)).handler(toWebRequest(event))
})
