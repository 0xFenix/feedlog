import { contentTransaction } from '#layers/feedlog/server/services/content-context'
import { createCollection } from '#layers/feedlog/server/services/help-center'
import { createHelpCollectionSchema } from '#layers/feedlog/shared/schemas/help'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })
  const body = await readValidatedBody(event, createHelpCollectionSchema.parse)
  const result = await contentTransaction(event, orgId, session.user.id, context => createCollection(context, body))
  setResponseStatus(event, 201)
  return result
})
