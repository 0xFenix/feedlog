import { contentTransaction } from '#layers/feedlog/server/services/content-context'
import { createBoard } from '#layers/feedlog/server/services/boards'
import { createBoardSchema } from '#layers/feedlog/shared/schemas/board'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })
  const body = await readValidatedBody(event, createBoardSchema.parse)
  const result = await contentTransaction(event, orgId, session.user.id, context => createBoard(context, body))
  setResponseStatus(event, 201)
  return result
})
