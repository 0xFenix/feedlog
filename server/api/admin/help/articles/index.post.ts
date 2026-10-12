import { contentTransaction } from '#layers/feedlog/server/services/content-context'
import { createArticle } from '#layers/feedlog/server/services/publishing'
import { createHelpArticleSchema } from '#layers/feedlog/shared/schemas/help'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })
  const body = await readValidatedBody(event, createHelpArticleSchema.parse)
  const result = await contentTransaction(event, orgId, session.user.id, context => createArticle(context, body))
  setResponseStatus(event, 201)
  return result
})
