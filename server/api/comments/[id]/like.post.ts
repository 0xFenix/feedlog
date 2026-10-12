import { contentTransaction } from '../../../services/content-context'
import { setCommentLike } from '../../../services/feedback'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireAuthInOrg(event)
  await assertGuestMay(event, session, 'allowVote')
  return contentTransaction(event, orgId, session.user.id, context => setCommentLike(context, getRouterParam(event, 'id')!, true))
})
