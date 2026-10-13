import { getRoadmap } from '#layers/feedlog/server/services/feedback-web-queries'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const orgId = event.context.orgId!
  const query = getQuery(event)
  const boardId = query.boardId as string | undefined

  return getRoadmap({ db: useDB(), orgId }, boardId, session?.user.id)
})
