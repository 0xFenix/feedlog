import { contentTransaction } from '../../../services/content-context'
import { setFeedbackVote } from '../../../services/feedback'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireAuthInOrg(event)
  return contentTransaction(event, orgId, session.user.id, context => setFeedbackVote(context, getRouterParam(event, 'postId')!, false))
})
