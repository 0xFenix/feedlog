import { z } from 'zod'
import { contentTransaction } from '../../../services/content-context'
import { mergeFeedback } from '../../../services/feedback'

const input = z.object({ canonicalPostId: z.uuid(), mergedPostId: z.uuid() })
export default defineEventHandler(async event => {
  const { session, orgId } = await requireOrgPermission(event, { feedlog: ['moderate'] })
  const body = await readValidatedBody(event, input.parse)
  await contentTransaction(event, orgId, session.user.id, context => mergeFeedback(context, body.mergedPostId, body.canonicalPostId))
  return { success: true }
})
