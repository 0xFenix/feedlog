import { contentTransaction } from '#layers/feedlog/server/services/content-context'
import { deleteArticle } from '#layers/feedlog/server/services/publishing'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })
  await contentTransaction(event, orgId, session.user.id, context => deleteArticle(context, getRouterParam(event, 'id')!))
  setResponseStatus(event, 204)
  return null
})
