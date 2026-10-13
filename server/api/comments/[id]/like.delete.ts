import { contentTransaction } from '../../../services/content-context'
import { setCommentLike } from '../../../services/comments'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireAuthInOrg(event)
  return contentTransaction(event, orgId, session.user.id, context => setCommentLike(context, getRouterParam(event, 'id')!, false))
})
