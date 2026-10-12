import { contentTransaction } from '../../../services/content-context'
import { updateFeedback } from '../../../services/feedback'
import { updatePostSchema } from '../../../../shared/schemas/post'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireAuthInOrg(event)
  const body = await readValidatedBody(event, updatePostSchema.pick({ title: true, content: true }).parse)
  return contentTransaction(event, orgId, session.user.id, context => updateFeedback(context, getRouterParam(event, 'postId')!, body))
})
