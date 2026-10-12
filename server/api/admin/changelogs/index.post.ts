import { contentTransaction } from '#layers/feedlog/server/services/content-context'
import { createChangelog } from '#layers/feedlog/server/services/publishing'
import { createChangelogSchema } from '#layers/feedlog/shared/schemas/changelog'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })
  const body = await readValidatedBody(event, createChangelogSchema.parse)
  const result = await contentTransaction(event, orgId, session.user.id, context => createChangelog(context, body))
  setResponseStatus(event, 201)
  return result
})
