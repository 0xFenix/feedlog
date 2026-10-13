import { contentTransaction } from '#layers/feedlog/server/services/content-context'
import { publishChangelog } from '#layers/feedlog/server/services/changelogs'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })
  const result = await contentTransaction(event, orgId, session.user.id, context => publishChangelog(context, getRouterParam(event, 'id')!))
  return result
})
