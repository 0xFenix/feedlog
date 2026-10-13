import { timestampCursorKey } from './query-pagination'
import { changelogRecord, changelogConditions, changelogSummaryFields } from './changelogs'
import { eq, and, desc, sql, or, isNotNull, inArray } from 'drizzle-orm'
import { changelog, user, changelogReaction } from '../db/schemas'
import type { ContentReader } from './content-context'
import { encodeWebCursor, decodeWebCursor } from './web-pagination'
import { createError } from 'h3'

export async function listManagementChangelogs(context: ContentReader, input: { status?: string; search?: string; page: number; pageSize: number }) {
  const { db, orgId } = context
  const { status, search, page, pageSize } = input
  const offset = (page - 1) * pageSize
  const conditions = changelogConditions(orgId, status)
  if (search && search.length >= 1) {
    conditions.push(
      or(
        sql`${search} <% ${changelog.title}`,
        sql`${search} <% ${changelog.content}`,
        sql`${search} <% ${changelog.publishedTitle}`,
        sql`${search} <% ${changelog.publishedContent}`,
      ),
    )
  }

  const whereClause = and(...conditions)

  const [countResult] = await db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(changelog)
    .where(whereClause)

  const rows = await db
    .select({
      ...changelogSummaryFields,
      status: changelog.status,
      categories: changelog.categories,
      cover: changelog.cover,
      publishedAt: changelog.publishedAt,
      cursorKey: timestampCursorKey(changelog.publishedAt),
      updatedAt: changelog.updatedAt,
      authorId: changelog.authorId,
      authorName: user.name,
      authorImage: user.image,
    })
    .from(changelog)
    .leftJoin(user, eq(changelog.authorId, user.id))
    .where(whereClause)
    .orderBy(
      ...(search
        ? [sql`LEAST(${search} <<-> ${changelog.title}, ${search} <<-> ${changelog.content}, ${search} <<-> ${changelog.publishedTitle}, ${search} <<-> ${changelog.publishedContent})`]
        : [desc(changelog.updatedAt), desc(changelog.id)]),
    )
    .limit(pageSize)
    .offset(offset)

  return {
    data: rows.map(r => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      status: r.status,
      categories: r.categories,
      cover: r.cover,
      publishedAt: r.publishedAt,
      updatedAt: r.updatedAt,
      author: { id: r.authorId, name: r.authorName, image: r.authorImage },
    })),
    pagination: { page, pageSize, total: countResult?.total ?? 0 },
  }
}

export async function getManagementChangelog(context: ContentReader, id: string) {
  const entry = await changelogRecord(context, id)
  const { slug, status, title, content, categories, cover, publishedAt, createdAt, updatedAt } = entry
  return { id, slug, status, title, content, categories, cover, publishedAt, createdAt, updatedAt }
}

export async function listPublicChangelogs(context: ContentReader, input: { cursor?: string; pageSize: number }, viewerId?: string) {
  const { db, orgId } = context
  const { cursor, pageSize } = input
  const conditions = [eq(changelog.orgId, orgId), isNotNull(changelog.publishedAt)]

  if (cursor) {
    const decoded = decodeWebCursor(cursor)
    if (decoded) {
      conditions.push(
        sql`(${changelog.publishedAt}, ${changelog.id}) < (${decoded.s}::timestamptz, ${decoded.id}::uuid)`,
      )
    }
  }

  const whereClause = and(...conditions)

  const rows = await db
    .select({
      id: changelog.id,
      slug: changelog.slug,
      title: changelog.publishedTitle,
      content: changelog.publishedContent,
      categories: changelog.publishedCategories,
      cover: changelog.publishedCover,
      publishedAt: changelog.publishedAt,
      cursorKey: timestampCursorKey(changelog.publishedAt),
    })
    .from(changelog)
    .where(whereClause)
    .orderBy(desc(changelog.publishedAt), desc(changelog.id))
    .limit(pageSize + 1)

  const hasMore = rows.length > pageSize
  const items = hasMore ? rows.slice(0, pageSize) : rows

  // Batch query reaction counts
  const changelogIds = items.map(r => r.id)
  const reactionCountsMap: Record<string, Record<string, number>> = {}
  const userReactionsMap: Record<string, string[]> = {}

  if (changelogIds.length > 0) {
    const reactionRows = await db
      .select({
        changelogId: changelogReaction.changelogId,
        emoji: changelogReaction.emoji,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(changelogReaction)
      .where(inArray(changelogReaction.changelogId, changelogIds))
      .groupBy(changelogReaction.changelogId, changelogReaction.emoji)

    for (const r of reactionRows) {
      if (!reactionCountsMap[r.changelogId]) reactionCountsMap[r.changelogId] = {}
      reactionCountsMap[r.changelogId]![r.emoji] = r.count
    }

    // User's own reactions
    if (viewerId) {
      const userReactions = await db
        .select({
          changelogId: changelogReaction.changelogId,
          emoji: changelogReaction.emoji,
        })
        .from(changelogReaction)
        .where(and(
          inArray(changelogReaction.changelogId, changelogIds),
          eq(changelogReaction.userId, viewerId!),
        ))

      for (const r of userReactions) {
        if (!userReactionsMap[r.changelogId]) userReactionsMap[r.changelogId] = []
        userReactionsMap[r.changelogId]!.push(r.emoji)
      }
    }
  }

  const data: ChangelogListItem[] = items.map(r => ({
    id: r.id,
    slug: r.slug,
    title: r.title ?? '',
    content: r.content ?? '',
    categories: (r.categories as string[]) ?? [],
    cover: r.cover ?? null,
    publishedAt: r.publishedAt!.toISOString(),
    reactionCounts: reactionCountsMap[r.id] ?? {},
    userReactions: userReactionsMap[r.id] ?? [],
  }))

  const lastItem = data[data.length - 1]
  const nextCursor = hasMore && lastItem
    ? encodeWebCursor({ s: items.at(-1)!.cursorKey, id: lastItem.id })
    : null

  return { data, pagination: { nextCursor } }
}

export async function getPublicChangelog(context: ContentReader, slug: string, viewerId?: string) {
  const { db, orgId } = context
  const [entry] = await db
    .select({
      id: changelog.id,
      slug: changelog.slug,
      title: changelog.publishedTitle,
      content: changelog.publishedContent,
      categories: changelog.publishedCategories,
      cover: changelog.publishedCover,
      publishedAt: changelog.publishedAt,
      cursorKey: timestampCursorKey(changelog.publishedAt),
    })
    .from(changelog)
    .where(and(eq(changelog.slug, slug), eq(changelog.orgId, orgId), isNotNull(changelog.publishedAt)))
    .limit(1)

  if (!entry) {
    throw createError({ statusCode: 404, message: 'Changelog not found' })
  }

  // Reaction counts
  const reactionRows = await db
    .select({
      emoji: changelogReaction.emoji,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(changelogReaction)
    .where(eq(changelogReaction.changelogId, entry.id))
    .groupBy(changelogReaction.emoji)

  const reactionCounts: Record<string, number> = {}
  for (const r of reactionRows) {
    reactionCounts[r.emoji] = r.count
  }

  // User's own reactions
  let userReactions: string[] = []
  if (viewerId) {
    const rows = await db
      .select({ emoji: changelogReaction.emoji })
      .from(changelogReaction)
      .where(and(
        eq(changelogReaction.changelogId, entry.id),
        eq(changelogReaction.userId, viewerId!),
      ))
    userReactions = rows.map(r => r.emoji)
  }

  return {
    id: entry.id,
    slug: entry.slug,
    title: entry.title ?? '',
    content: entry.content ?? '',
    categories: (entry.categories as string[]) ?? [],
    cover: entry.cover ?? null,
    publishedAt: entry.publishedAt!.toISOString(),
    reactionCounts,
    userReactions,
  }
}
