import { contentTransaction } from '#layers/feedlog/server/services/content-context'
import { updateFeedback } from '#layers/feedlog/server/services/feedback'
import { updatePostSchema } from '#layers/feedlog/shared/schemas/post'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })
  const body = await readValidatedBody(event, updatePostSchema.parse)
  const result = await contentTransaction(event, orgId, session.user.id, context => updateFeedback(context, getRouterParam(event, 'id')!, body))
  return result
})
