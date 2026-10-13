import { contentTransaction } from '#layers/feedlog/server/services/content-context'
import { deleteBoard } from '#layers/feedlog/server/services/boards'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })
  await contentTransaction(event, orgId, session.user.id, context => deleteBoard(context, getRouterParam(event, 'id')!))
  setResponseStatus(event, 204)
  return null
})
