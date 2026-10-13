import type { H3Event } from 'h3'
import type { z } from 'zod'
import { contentTransaction } from './content-context'
import { createComment, feedbackCommentSchema } from './comments'
import { feedbackRecord } from './feedback'

export const createCommentSchema = feedbackCommentSchema
export async function createFeedbackComment(
  event: H3Event,
  { session, orgId }: { session: { user: { id: string; isAnonymous?: boolean | null }; orgList?: { orgId: string; role: string }[] }; orgId: string },
  postId: string,
  body: z.infer<typeof createCommentSchema>,
) {
  return contentTransaction(event, orgId, session.user.id, async context => {
    const feedback = await feedbackRecord(context, postId)
    if (feedback.authorId !== session.user.id) await assertGuestMay(event, session, 'allowComment')
    return createComment(context, postId, body)
  })
}
