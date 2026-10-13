import { cursorPage, literalSubstring, type CursorPageInput } from './query-pagination'
import { and, eq, ilike, or } from 'drizzle-orm'
import type { z } from 'zod'
import { changelog, changelogReaction } from '../db/schemas'
import { createChangelogSchema, updateChangelogSchema } from '../../shared/schemas/changelog'
import { contentError, requireModerator, type ContentReader, type ContentContext } from './content-context'

export async function changelogRecord(context: ContentReader, id: string, lock = false) {
  const query = context.db.select({ ...changelogSummaryFields, content: changelog.content, publishedContent: changelog.publishedContent }).from(changelog).where(and(eq(changelog.id, id), eq(changelog.orgId, context.orgId)))
  const [record] = await (lock ? query.for('update') : query)
  if (!record) throw contentError(404, 'Changelog not found')
  return record
}
export async function createChangelog(context: ContentContext, body: z.infer<typeof createChangelogSchema>) {
  requireModerator(context)
  const input = createChangelogSchema.parse(body)
  const [record] = await context.db.insert(changelog).values({ ...input, orgId: context.orgId, authorId: context.userId, slug: await generateChangelogSlug(input.title) }).returning()
  return record!
}
export async function updateChangelog(context: ContentContext, id: string, body: z.infer<typeof updateChangelogSchema>) {
  requireModerator(context)
  const input = updateChangelogSchema.parse(body)
  if (!Object.values(input).some(value => value !== undefined)) throw contentError(400, 'No fields to update')
  const existing = await changelogRecord(context, id, true)
  const [record] = await context.db.update(changelog).set({ ...input, ...(existing.status === 'published' ? { status: 'needs_update' } : {}) }).where(and(eq(changelog.id, id), eq(changelog.orgId, context.orgId))).returning()
  return record!
}
export async function publishChangelog(context: ContentContext, id: string) {
  requireModerator(context)
  const existing = await changelogRecord(context, id, true)
  if (!existing.title.trim() || !existing.content.trim()) throw contentError(400, 'Title and content are required to publish')
  const [record] = await context.db.update(changelog).set({
    publishedTitle: existing.title, publishedContent: existing.content, publishedCategories: existing.categories,
    publishedCover: existing.cover, status: 'published', publishedAt: new Date(),
  }).where(and(eq(changelog.id, id), eq(changelog.orgId, context.orgId))).returning()
  return record!
}
export async function deleteChangelog(context: ContentContext, id: string) {
  requireModerator(context)
  await changelogRecord(context, id, true)
  await context.db.delete(changelogReaction).where(eq(changelogReaction.changelogId, id))
  await context.db.delete(changelog).where(and(eq(changelog.id, id), eq(changelog.orgId, context.orgId)))
  return { id, deleted: true }
}

export const changelogSummaryFields = {
  id: changelog.id, orgId: changelog.orgId, authorId: changelog.authorId, slug: changelog.slug,
  status: changelog.status, title: changelog.title, categories: changelog.categories, cover: changelog.cover,
  publishedTitle: changelog.publishedTitle, publishedCategories: changelog.publishedCategories, publishedCover: changelog.publishedCover,
  publishedAt: changelog.publishedAt, createdAt: changelog.createdAt, updatedAt: changelog.updatedAt,
}
export function changelogConditions(orgId: string, status?: string) {
  return [eq(changelog.orgId, orgId), status ? eq(changelog.status, status) : undefined]
}
export async function listChangelogs(context: ContentReader, input: CursorPageInput & { query?: string; status?: string; sort?: 'created_desc' | 'created_asc' | 'updated_desc' }) {
  const filter = { query: input.query, status: input.status, sort: input.sort }
  const page = await cursorPage(input, { kind: 'changelogs', organizationId: context.orgId, filter, sort: input.sort === 'updated_desc' ? 'updated_at' : 'created_at', ascending: input.sort === 'created_asc' }, input.sort === 'updated_desc' ? changelog.updatedAt : changelog.createdAt, changelog.id, input.sort === 'created_asc')
  const rows = await context.db.select({ ...changelogSummaryFields, cursorKey: page.cursorKey }).from(changelog)
    .where(and(...changelogConditions(context.orgId, input.status), input.query ? or(ilike(changelog.title, literalSubstring(input.query)), ilike(changelog.content, literalSubstring(input.query))) : undefined, page.after))
    .orderBy(...page.orderBy).limit(input.limit + 1)
  return page.finish(rows)
}
