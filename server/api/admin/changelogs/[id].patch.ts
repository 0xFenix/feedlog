import { contentTransaction } from '#layers/feedlog/server/services/content-context'
import { updateChangelog } from '#layers/feedlog/server/services/changelogs'
import { updateChangelogSchema } from '#layers/feedlog/shared/schemas/changelog'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })
  const body = await readValidatedBody(event, updateChangelogSchema.parse)
  const result = await contentTransaction(event, orgId, session.user.id, context => updateChangelog(context, getRouterParam(event, 'id')!, body))
  return result
})
