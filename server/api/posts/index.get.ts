import { listPublicFeedback } from '#layers/feedlog/server/services/feedback-web-queries'

export default defineEventHandler(async (event): Promise<CursorPaginatedList<PostListItem>> => {
  const session = await getUserSession(event)
  const query = getQuery(event)

  const boardId = query.boardId as string | undefined
  const status = query.status as string | undefined
  const sort = (query.sort as string) || 'createdAt'
  const order = (query.order as string) || 'desc'
  const cursor = query.cursor as string | undefined
  const pageSize = Math.min(Number(query.pageSize) || 10, 100)

  const orgId = event.context.orgId!

  return listPublicFeedback({ db: useDB(), orgId }, { boardId, status, sort, order, cursor, pageSize }, session?.user.id)
})
