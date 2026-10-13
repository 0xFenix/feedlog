import { getManagementChangelog } from '#layers/feedlog/server/services/changelog-queries'

export default defineEventHandler(async (event) => {
  const { orgId } = await requireOrgMember(event)

  const id = getRouterParam(event, 'id')!

  return getManagementChangelog({ db: useDB(), orgId }, id)
})
