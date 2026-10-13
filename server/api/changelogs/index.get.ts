import { listPublicChangelogs } from '#layers/feedlog/server/services/changelog-queries'

export default defineEventHandler(async (event): Promise<CursorPaginatedList<ChangelogListItem>> => {
  const session = await getUserSession(event)
  const orgId = event.context.orgId!
  const query = getQuery(event)

  const cursor = query.cursor as string | undefined
  const pageSize = Math.min(Number(query.pageSize) || 10, 50)

  return listPublicChangelogs({ db: useDB(), orgId }, { cursor, pageSize }, session?.user.id)
})
