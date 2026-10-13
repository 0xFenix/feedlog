import { contentTransaction } from '../../../../services/content-context'
import { deleteCollection } from '../../../../services/help-center'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })
  await contentTransaction(event, orgId, session.user.id, context => deleteCollection(context, getRouterParam(event, 'id')!))
  setResponseStatus(event, 204)
  return null
})
