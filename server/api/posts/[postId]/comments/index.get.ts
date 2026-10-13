import { listCommentThreads } from '#layers/feedlog/server/services/comment-threads'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const orgId = event.context.orgId!
  const postId = getRouterParam(event, 'postId')!
  const query = getQuery(event)

  const parentId = query.parentId as string | undefined
  const cursor = query.cursor as string | undefined
  const limit = Math.min(Number(query.limit) || 10, 100)
  const sort = (query.sort as string) || 'oldest'
  const withChildren = query.withChildren === 'true'
  const childrenLimit = Math.min(Number(query.childrenLimit) || 5, 20)

  return listCommentThreads({ db: useDB(), orgId }, postId, { parentId, cursor, limit, sort, withChildren, childrenLimit }, session?.user.id)
})
