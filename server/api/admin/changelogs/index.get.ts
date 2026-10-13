import { listManagementChangelogs } from '#layers/feedlog/server/services/changelog-queries'

export default defineEventHandler(async (event) => {
  const { orgId } = await requireOrgMember(event)

  const query = getQuery(event)
  const status = query.status as string | undefined
  const search = (query.search as string)?.trim()
  const page = Math.max(Number(query.page) || 1, 1)
  const pageSize = Math.min(Number(query.pageSize) || 10, 100)

  return listManagementChangelogs({ db: useDB(), orgId }, { status, search, page, pageSize })
})
