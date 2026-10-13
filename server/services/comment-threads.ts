import { timestampCursorKey } from './query-pagination'
import { feedbackRecord } from './feedback'
import { eq, and, desc, asc, sql, isNull, isNotNull, inArray } from 'drizzle-orm'
import { comment, commentLike, user, post, member } from '../db/schemas'
import type { ContentReader } from './content-context'
import { encodeWebCursor, decodeWebCursor } from './web-pagination'


interface CommentRow {
  id: string; postId?: string; parentId: string | null; replyToId: string | null
  replyCount?: number; likeCount: number; authorId: string; authorName: string | null
  authorImage: string | null; authorIsAnonymous: boolean | null; content: string
  cursorKey?: string; type?: string; metadata?: unknown; editedAt: Date | null; createdAt: Date; hasLiked?: boolean
}
interface MergedPostInfo {
  id: string; slug: string; title: string; excerpt: string | null; commentCount?: number
  author: { id: string; name: string | null; image: string | null; isAnonymous: boolean }
}
type ThreadComment = ReturnType<typeof formatComment> & {
  children?: ThreadComment[]
  mergedPost?: { post: MergedPostInfo | null; comments: { data: ThreadComment[]; pagination: { nextCursor: string | null } } }
}
function mergedFeedbackId(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object' || !('merged_post_id' in metadata)) return undefined
  return typeof metadata.merged_post_id === 'string' ? metadata.merged_post_id : undefined
}

export async function listCommentThreads(context: ContentReader, postId: string, input: { parentId?: string; cursor?: string; limit: number; sort: string; withChildren: boolean; childrenLimit: number }, viewerId?: string) {
  const { db } = context
  const { parentId, cursor, limit, sort, withChildren, childrenLimit } = input
  await feedbackRecord(context, postId)

  const adminIds = await resolveAdminAuthorIds(context)

  // Loading child comments for a specific parent
  if (parentId) {
    const conditions = [
      eq(comment.postId, postId),
      eq(comment.parentId, parentId),
    ]
    if (cursor) {
      const decoded = decodeWebCursor(cursor)
      if (decoded) {
        conditions.push(sql`(${comment.createdAt}, ${comment.id}) > (${decoded.s}::timestamptz, ${decoded.id}::uuid)`)
      }
    }

    const rows = await db
      .select({
        id: comment.id,
        parentId: comment.parentId,
        replyToId: comment.replyToId,
        likeCount: comment.likeCount,
        authorId: comment.authorId,
        authorName: user.name,
        authorImage: user.image,
        authorIsAnonymous: user.isAnonymous,
        content: comment.content,
        editedAt: comment.editedAt,
        createdAt: comment.createdAt,
        cursorKey: timestampCursorKey(comment.createdAt),
      })
      .from(comment)
      .leftJoin(user, eq(comment.authorId, user.id))
      .where(and(...conditions))
      .orderBy(asc(comment.createdAt), asc(comment.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const data = await attachLikeStatus(db, items, viewerId, adminIds)

    const lastItem = items[items.length - 1]
    return {
      data,
      pagination: {
        nextCursor: hasMore && lastItem
          ? encodeWebCursor({ s: lastItem.cursorKey, id: lastItem.id })
          : null,
      },
    }
  }

  // Loading top-level comments (includes both comment and mergedPost types)
  const conditions = [
    eq(comment.postId, postId),
    isNull(comment.parentId),
  ]

  if (cursor) {
    const decoded = decodeWebCursor(cursor)
    if (decoded) {
      if (sort === 'top') {
        conditions.push(sql`(${comment.likeCount}, ${comment.id}) < (${decoded.s}::int, ${decoded.id}::uuid)`)
      } else if (sort === 'newest') {
        conditions.push(sql`(${comment.createdAt}, ${comment.id}) < (${decoded.s}::timestamptz, ${decoded.id}::uuid)`)
      } else {
        conditions.push(sql`(${comment.createdAt}, ${comment.id}) > (${decoded.s}::timestamptz, ${decoded.id}::uuid)`)
      }
    }
  }

  const orderBy = sort === 'newest'
    ? [desc(comment.createdAt), desc(comment.id)]
    : sort === 'top'
      ? [desc(comment.likeCount), desc(comment.id)]
      : [asc(comment.createdAt), asc(comment.id)]

  const topRows = await db
    .select({
      id: comment.id,
      parentId: comment.parentId,
      replyToId: comment.replyToId,
      replyCount: comment.replyCount,
      likeCount: comment.likeCount,
      authorId: comment.authorId,
      authorName: user.name,
      authorImage: user.image,
      authorIsAnonymous: user.isAnonymous,
      content: comment.content,
      type: comment.type,
      metadata: comment.metadata,
      editedAt: comment.editedAt,
      createdAt: comment.createdAt,
      cursorKey: timestampCursorKey(comment.createdAt),
    })
    .from(comment)
    .leftJoin(user, eq(comment.authorId, user.id))
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(limit + 1)

  const hasMore = topRows.length > limit
  const topItems = hasMore ? topRows.slice(0, limit) : topRows

  // Eager-load children if requested
  const childrenMap = new Map<string, CommentRow[]>()
  const formattedChildren = new Map<string, ThreadComment[]>()
  if (withChildren && topItems.length > 0) {
    const topIds = topItems.map(t => t.id)
    const childRows = await db
      .select({
        id: comment.id,
        parentId: comment.parentId,
        replyToId: comment.replyToId,
        likeCount: comment.likeCount,
        authorId: comment.authorId,
        authorName: user.name,
        authorImage: user.image,
        authorIsAnonymous: user.isAnonymous,
        content: comment.content,
        editedAt: comment.editedAt,
        createdAt: comment.createdAt,
        cursorKey: timestampCursorKey(comment.createdAt),
      })
      .from(comment)
      .leftJoin(user, eq(comment.authorId, user.id))
      .where(and(
        eq(comment.postId, postId),
        isNotNull(comment.parentId),
        inArray(comment.parentId, topIds),
      ))
      .orderBy(asc(comment.createdAt), asc(comment.id))

    // Group by parentId, limit per parent
    for (const child of childRows) {
      const pid = child.parentId!
      if (!childrenMap.has(pid)) childrenMap.set(pid, [])
      const arr = childrenMap.get(pid)!
      if (arr.length < childrenLimit) arr.push(child)
    }

    // Attach like status to children
    for (const [parentId, children] of childrenMap) {
      const enriched = await attachLikeStatus(db, children, viewerId, adminIds)
      formattedChildren.set(parentId, enriched)
    }
  }

  const topData = await attachLikeStatus(db, topItems, viewerId, adminIds)

  // Enrich mergedPost entries: fetch post info + sub-post comments
  const mergedPostItems = topItems.filter(t => t.type === 'mergedPost' && t.metadata)
  const mergedPostIds = mergedPostItems
    .map(t => mergedFeedbackId(t.metadata))
    .filter(Boolean) as string[]

  const mergedPostInfoMap = new Map<string, MergedPostInfo>()
  const mergedPostCommentsMap = new Map<string, { data: ThreadComment[]; pagination: { nextCursor: string | null } }>()

  if (mergedPostIds.length > 0) {
    // Step 3: Fetch merged post info (parallel with Step 2B)
    const [postInfoRows, subCommentRows] = await Promise.all([
      db
        .select({
          id: post.id,
          slug: post.slug,
          title: post.title,
          excerpt: post.excerpt,
          authorId: post.authorId,
          authorName: user.name,
          authorImage: user.image,
          authorIsAnonymous: user.isAnonymous,
        })
        .from(post)
        .leftJoin(user, eq(post.authorId, user.id))
        .where(and(inArray(post.id, mergedPostIds), eq(post.orgId, context.orgId))),
      // Step 2B: Fetch sub-post top-level comments
      db
        .select({
          id: comment.id,
          postId: comment.postId,
          parentId: comment.parentId,
          replyToId: comment.replyToId,
          replyCount: comment.replyCount,
          likeCount: comment.likeCount,
          authorId: comment.authorId,
          authorName: user.name,
          authorImage: user.image,
          authorIsAnonymous: user.isAnonymous,
          content: comment.content,
          type: comment.type,
          metadata: comment.metadata,
          editedAt: comment.editedAt,
          createdAt: comment.createdAt,
          cursorKey: timestampCursorKey(comment.createdAt),
        })
        .from(comment)
        .leftJoin(user, eq(comment.authorId, user.id))
        .where(and(
          inArray(comment.postId, db.select({ id: post.id }).from(post).where(and(inArray(post.id, mergedPostIds), eq(post.orgId, context.orgId)))),
          isNull(comment.parentId),
        ))
        .orderBy(asc(comment.createdAt), asc(comment.id))
        .limit((childrenLimit + 1) * mergedPostIds.length),
    ])

    // Build post info map
    for (const r of postInfoRows) {
      mergedPostInfoMap.set(r.id, {
        id: r.id,
        slug: r.slug,
        title: r.title,
        excerpt: r.excerpt,
        author: { id: r.authorId, name: r.authorName, image: r.authorImage, isAnonymous: !!r.authorIsAnonymous },
      })
    }

    // Build sub-post comments map (group by postId, limit per post)
    const groupedSubComments = new Map<string, typeof subCommentRows>()
    for (const r of subCommentRows) {
      if (!groupedSubComments.has(r.postId)) groupedSubComments.set(r.postId, [])
      groupedSubComments.get(r.postId)!.push(r)
    }

    // Collect second-level merged post IDs from sub-comments
    const level2MergedPostIds: string[] = []
    for (const r of subCommentRows) {
      if (r.type === 'mergedPost' && r.metadata) {
        const l2Id = mergedFeedbackId(r.metadata)
        if (l2Id) level2MergedPostIds.push(l2Id)
      }
    }

    // Fetch second-level merged post info (title + excerpt only, no recursive comments)
    const level2PostInfoMap = new Map<string, MergedPostInfo>()
    if (level2MergedPostIds.length > 0) {
      const l2Rows = await db
        .select({
          id: post.id,
          slug: post.slug,
          title: post.title,
          excerpt: post.excerpt,
          commentCount: post.commentCount,
          authorId: post.authorId,
          authorName: user.name,
          authorImage: user.image,
          authorIsAnonymous: user.isAnonymous,
        })
        .from(post)
        .leftJoin(user, eq(post.authorId, user.id))
        .where(and(inArray(post.id, level2MergedPostIds), eq(post.orgId, context.orgId)))
      for (const r of l2Rows) {
        level2PostInfoMap.set(r.id, {
          id: r.id,
          slug: r.slug,
          title: r.title,
          excerpt: r.excerpt,
          commentCount: r.commentCount,
          author: { id: r.authorId, name: r.authorName, image: r.authorImage, isAnonymous: !!r.authorIsAnonymous },
        })
      }
    }

    for (const mpId of mergedPostIds) {
      const allSubComments = groupedSubComments.get(mpId) ?? []
      const hasMoreSub = allSubComments.length > childrenLimit
      const subItems = hasMoreSub ? allSubComments.slice(0, childrenLimit) : allSubComments
      const subData = await attachLikeStatus(db, subItems, viewerId, adminIds)

      // Enrich second-level mergedPost sub-comments with post info
      const enrichedSubData = subData.map(c => {
        const raw = subItems.find(s => s.id === c.id)
        if (raw?.type === 'mergedPost' && raw.metadata) {
          const l2Id = mergedFeedbackId(raw.metadata)
          const l2Info = l2Id ? level2PostInfoMap.get(l2Id) : null
          if (l2Info) {
            return {
              ...c,
              type: 'mergedPost',
              mergedPost: {
                post: l2Info,
                comments: { data: [], pagination: { nextCursor: null } },
              },
            }
          }
        }
        return { ...c, type: c.type ?? 'comment' }
      })

      const lastSub = subItems[subItems.length - 1]
      mergedPostCommentsMap.set(mpId, {
        data: enrichedSubData,
        pagination: {
          nextCursor: hasMoreSub && lastSub
            ? encodeWebCursor({ s: lastSub.cursorKey, id: lastSub.id })
            : null,
        },
      })
    }
  }

  // Step 4: Assemble final response
  const data = topData.map(item => {
    const raw = topItems.find(t => t.id === item.id)!
    const result: ThreadComment = {
      ...item,
      type: raw.type ?? 'comment',
      children: withChildren ? (formattedChildren.get(item.id) ?? []) : undefined,
    }

    if (raw.type === 'mergedPost' && raw.metadata) {
      const mpId = mergedFeedbackId(raw.metadata)
      if (mpId) {
        result.mergedPost = {
          post: mergedPostInfoMap.get(mpId) ?? null,
          comments: mergedPostCommentsMap.get(mpId) ?? { data: [], pagination: { nextCursor: null } },
        }
      }
    }

    return result
  })

  const lastItem = topItems[topItems.length - 1]
  let nextCursor: string | null = null
  if (hasMore && lastItem) {
    nextCursor = sort === 'top'
      ? encodeWebCursor({ s: lastItem.likeCount, id: lastItem.id })
      : encodeWebCursor({ s: lastItem.cursorKey, id: lastItem.id })
  }

  return {
    data,
    pagination: { nextCursor },
  }
}


async function resolveAdminAuthorIds({ db, orgId }: ContentReader): Promise<Set<string>> {
  const rows = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), inArray(member.role, ['owner', 'manager'])))
  return new Set(rows.map(r => r.userId))
}

// Format comment row to API response
function formatComment(r: CommentRow, adminIds: Set<string>) {
  return {
    id: r.id,
    parentId: r.parentId,
    replyToId: r.replyToId,
    replyCount: r.replyCount ?? undefined,
    likeCount: r.likeCount,
    hasLiked: r.hasLiked ?? false,
    author: { id: r.authorId, name: r.authorName, image: r.authorImage, isAnonymous: !!r.authorIsAnonymous, isAdmin: adminIds.has(r.authorId) },
    content: r.content,
    type: r.type ?? 'comment',
    editedAt: r.editedAt,
    createdAt: r.createdAt,
  }
}

// Batch attach hasLiked status
async function attachLikeStatus(db: ContentReader['db'], items: CommentRow[], userId: string | undefined, adminIds: Set<string>) {
  if (!userId || items.length === 0) {
    return items.map(r => formatComment(r, adminIds))
  }

  const commentIds = items.map(r => r.id)
  const likes = await db
    .select({ commentId: commentLike.commentId })
    .from(commentLike)
    .where(and(
      eq(commentLike.userId, userId),
      inArray(commentLike.commentId, commentIds),
    ))
  const likedSet = new Set(likes.map(l => l.commentId))

  return items.map(r => ({
    ...formatComment(r, adminIds),
    hasLiked: likedSet.has(r.id),
  }))
}
