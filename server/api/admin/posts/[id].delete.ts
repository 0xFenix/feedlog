import { contentTransaction } from '#layers/feedlog/server/services/content-context'
import { deleteFeedback } from '#layers/feedlog/server/services/feedback'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })
  await contentTransaction(event, orgId, session.user.id, context => deleteFeedback(context, getRouterParam(event, 'id')!))
  setResponseStatus(event, 204)
  return null
})
