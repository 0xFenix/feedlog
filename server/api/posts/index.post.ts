import { createPostSchema } from '#layers/feedlog/shared/schemas/post'
import { contentTransaction } from '../../services/content-context'
import { createFeedback } from '../../services/feedback'

// POST /api/posts — Create a post (any authenticated user: end-user or staff).
export default defineEventHandler(async (event) => {
  const { session, orgId } = await requireAuthInOrg(event)
  await assertGuestMay(event, session, 'allowPost')

  const body = await readValidatedBody(event, createPostSchema.parse)

  const created = await contentTransaction(event, orgId, session.user.id, context => createFeedback(context, body))

  const author = await fetchPostAuthor(session.user.id)

  setResponseStatus(event, 201)
  return {
    id: created.id,
    slug: created.slug,
    title: created.title,
    content: created.content,
    status: created.status,
    boardId: created.boardId,
    voteCount: created.voteCount,
    commentCount: created.commentCount,
    mergedCount: 0,
    mergedTo: null,
    hasVoted: false,
    author: author ?? { id: session.user.id, name: null, image: null },
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  } satisfies PostDetail
})
