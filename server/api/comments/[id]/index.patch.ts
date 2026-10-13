import { contentTransaction } from '../../../services/content-context'
import { feedbackCommentSchema, updateComment } from '../../../services/comments'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireAuthInOrg(event)
  const body = await readValidatedBody(event, feedbackCommentSchema.pick({ content: true }).parse)
  return contentTransaction(event, orgId, session.user.id, context => updateComment(context, getRouterParam(event, 'id')!, body.content))
})
