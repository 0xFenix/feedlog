import { createCommentSchema, createFeedbackComment } from '#layers/feedlog/server/services/feedback-comment'

export default defineEventHandler(async event => {
  const actor = await requireAuthInOrg(event)
  const postId = getRouterParam(event, 'postId')!
  const body = await readValidatedBody(event, createCommentSchema.parse)
  const result = await createFeedbackComment(event, actor, postId, body)
  setResponseStatus(event, 201)
  return result
})
