import { and, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { changelog, changelogReaction, helpArticle, helpCollection, organization } from '../db/schemas'
import { createHelpArticleSchema, createHelpCollectionSchema, updateHelpArticleSchema, updateHelpCollectionSchema } from '../../shared/schemas/help'
import { createChangelogSchema, updateChangelogSchema } from '../../shared/schemas/changelog'
import { buildHelpTsv, withHelpShortId, generateHelpSlug } from '../utils/help'
import { resolvePortalModules } from '../../shared/utils/portal-modules'
import { contentError, requireModerator, type ContentContext } from './content-context'

async function lockHelpContent(context: ContentContext) {
  // Collection deletion and article movement must acquire locks in the same order.
  await context.db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${context.orgId + ':help'}, 0))`)
}

export async function helpCollectionRecord(context: ContentContext, id: string) {
  const [record] = await context.db.select().from(helpCollection).where(and(eq(helpCollection.id, id), eq(helpCollection.orgId, context.orgId))).for('share')
  if (!record) throw contentError(404, 'Collection not found')
  return record
}
export async function createCollection(context: ContentContext, body: z.infer<typeof createHelpCollectionSchema>) {
  requireModerator(context)
  await lockHelpContent(context)
  const input = createHelpCollectionSchema.parse(body)
  const [last] = await context.db.select({ position: sql<number>`coalesce(max(${helpCollection.position}), -1)::int` }).from(helpCollection).where(eq(helpCollection.orgId, context.orgId))
  const [record] = await context.db.insert(helpCollection).values({ ...input, orgId: context.orgId, position: (last?.position ?? -1) + 1 }).returning()
  return { ...record!, articleCount: 0, articles: [] }
}
export async function updateCollection(context: ContentContext, id: string, body: z.infer<typeof updateHelpCollectionSchema>) {
  requireModerator(context)
  await lockHelpContent(context)
  const input = updateHelpCollectionSchema.parse(body)
  if (!Object.values(input).some(value => value !== undefined)) throw contentError(400, 'No fields to update')
  const [record] = await context.db.update(helpCollection).set(input).where(and(eq(helpCollection.id, id), eq(helpCollection.orgId, context.orgId))).returning()
  if (!record) throw contentError(404, 'Collection not found')
  const articles = await context.db.select({ id: helpArticle.id, title: helpArticle.title, status: helpArticle.status, shortId: helpArticle.shortId, slug: helpArticle.slug, position: helpArticle.position, aiEnabled: helpArticle.aiEnabled, updatedAt: helpArticle.updatedAt }).from(helpArticle).where(and(eq(helpArticle.collectionId, id), eq(helpArticle.orgId, context.orgId))).orderBy(helpArticle.position, helpArticle.id)
  return { ...record, articleCount: articles.length, articles }
}

export async function deleteCollection(context: ContentContext, id: string) {
  requireModerator(context)
  await lockHelpContent(context)
  const [deleted] = await context.db.delete(helpCollection).where(and(eq(helpCollection.id, id), eq(helpCollection.orgId, context.orgId))).returning()
  if (!deleted) throw contentError(404, 'Collection not found')
  await context.db.delete(helpArticle).where(and(eq(helpArticle.collectionId, id), eq(helpArticle.orgId, context.orgId)))
}
export async function articleRecord(context: ContentContext, id: string, view: 'management' | 'public' = 'management', lock = false) {
  const query = context.db.select().from(helpArticle).where(and(eq(helpArticle.id, id), eq(helpArticle.orgId, context.orgId)))
  const [record] = await (lock ? query.for('update') : query)
  if (!record) throw contentError(404, 'Article not found')
  const collection = await helpCollectionRecord(context, record.collectionId)
  const [org] = await context.db.select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, context.orgId))
  const visible = record.status === 'published' && collection.visible && resolvePortalModules(org?.metadata).helpCenter
  if (view === 'public' && !visible) throw contentError(404, 'Article is not publicly available')
  const { tsv: _tsv, ...article } = record
  return { ...article, collection: { id: collection.id, name: collection.name, visible: collection.visible } }
}
async function articlePosition(context: ContentContext, collectionId: string) {
  const [last] = await context.db.select({ position: sql<number>`coalesce(max(${helpArticle.position}), -1)::int` }).from(helpArticle).where(and(eq(helpArticle.collectionId, collectionId), eq(helpArticle.orgId, context.orgId)))
  return (last?.position ?? -1) + 1
}
export async function createArticle(context: ContentContext, body: z.infer<typeof createHelpArticleSchema>) {
  requireModerator(context)
  await lockHelpContent(context)
  const input = createHelpArticleSchema.parse(body)
  await helpCollectionRecord(context, input.collectionId)
  const position = await articlePosition(context, input.collectionId)
  const record = await withHelpShortId(shortId => context.db.transaction(async savepoint => {
    const [created] = await savepoint.insert(helpArticle).values({
    orgId: context.orgId, collectionId: input.collectionId, shortId, slug: generateHelpSlug(input.title),
    status: input.publish ? 'published' : 'draft', title: input.title, description: input.description ?? null, content: input.content,
    aiEnabled: input.aiEnabled, tsv: buildHelpTsv(input.title, input.description ?? null, input.content),
    position, publishedAt: input.publish ? new Date() : null,
  }).returning()
    return created!
  }))
  return articleRecord(context, record.id)
}
export async function updateArticle(context: ContentContext, id: string, body: z.infer<typeof updateHelpArticleSchema>) {
  requireModerator(context)
  await lockHelpContent(context)
  const input = updateHelpArticleSchema.parse(body)
  if (!Object.values(input).some(value => value !== undefined)) throw contentError(400, 'No fields to update')
  const existing = await articleRecord(context, id, 'management', true)
  const title = input.title ?? existing.title
  const content = input.content ?? existing.content
  const description = input.description === undefined ? existing.description : input.description
  const changed = title !== existing.title || content !== existing.content || description !== existing.description
  const updates: Omit<Partial<typeof helpArticle.$inferInsert>, 'tsv'> & { tsv?: ReturnType<typeof buildHelpTsv> } = { ...input, updatedAt: new Date() }
  if (input.collectionId && input.collectionId !== existing.collectionId) {
    await helpCollectionRecord(context, input.collectionId)
    updates.position = await articlePosition(context, input.collectionId)
  }
  if (changed) {
    updates.tsv = buildHelpTsv(title, description, content)
    if (title !== existing.title) updates.slug = generateHelpSlug(title)
  }
  const status = input.status ?? (existing.status === 'archived' && changed ? 'draft' : undefined)
  if (status === 'published') {
    if (!title.trim() || !content.trim()) throw contentError(400, 'Title and content are required to publish')
    updates.publishedAt = existing.publishedAt ?? new Date()
  }
  if (status === 'archived' && existing.status !== 'published') throw contentError(409, 'Only a published article can be unpublished')
  if (status) updates.status = status
  await context.db.update(helpArticle).set(updates).where(and(eq(helpArticle.id, id), eq(helpArticle.orgId, context.orgId)))
  return articleRecord(context, id)
}
export async function deleteArticle(context: ContentContext, id: string) {
  requireModerator(context)
  await lockHelpContent(context)
  const [record] = await context.db.delete(helpArticle).where(and(eq(helpArticle.id, id), eq(helpArticle.orgId, context.orgId))).returning({ id: helpArticle.id })
  if (!record) throw contentError(404, 'Article not found')
  return { id, deleted: true }
}
export async function changelogRecord(context: ContentContext, id: string, lock = false) {
  const query = context.db.select().from(changelog).where(and(eq(changelog.id, id), eq(changelog.orgId, context.orgId)))
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
