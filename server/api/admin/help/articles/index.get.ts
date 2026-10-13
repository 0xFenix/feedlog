import { listManagementArticles } from '#layers/feedlog/server/services/help-center-queries'

export default defineEventHandler(async (event) => {
  const { orgId } = await requireOrgMember(event)

  const query = getQuery(event)
  const q = (query.q as string)?.trim()
  const page = Math.max(Number(query.page) || 1, 1)
  const pageSize = Math.min(Number(query.pageSize) || 10, 100)

  return listManagementArticles({ db: useDB(), orgId }, { q, page, pageSize })
})
