import { z } from 'zod'
import { contentTransaction } from '../../../services/content-context'
import { unmergeFeedback } from '../../../services/feedback'

export default defineEventHandler(async event => {
  const { session, orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })
  const body = await readValidatedBody(event, z.object({ postId: z.uuid() }).parse)
  await contentTransaction(event, orgId, session.user.id, context => unmergeFeedback(context, body.postId))
  return { success: true }
})
