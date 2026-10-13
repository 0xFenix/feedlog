import { contentTransaction } from '#layers/feedlog/server/services/content-context'
import { updateBoard } from '#layers/feedlog/server/services/boards'
import { updateBoardSchema } from '#layers/feedlog/shared/schemas/board'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })
  const body = await readValidatedBody(event, updateBoardSchema.parse)
  const result = await contentTransaction(event, orgId, session.user.id, context => updateBoard(context, getRouterParam(event, 'id')!, body))
  return result
})
