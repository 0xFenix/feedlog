import { buildPostLink } from '../utils/post-link-builder'
import type { ContentContext } from '../services/content-context'

export function recordLink(context: ContentContext, orgSlug: string, kind: 'feedback' | 'article' | 'changelog', record: { slug: string; shortId?: string }) {
  const path = kind === 'feedback' ? `/p/${record.slug}` : kind === 'article' ? `/help/${record.shortId}-${record.slug}` : `/changelog/${record.slug}`
  return buildPostLink(orgSlug, path, context.origin)
}
export function toolRecord(value: unknown, origin?: string): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(child => toolRecord(child, origin))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const field = key.replace(/[A-Z]/g, char => '_' + char.toLowerCase())
    const names: Record<string, string> = { org_id: 'organization_id', post_id: 'feedback_id', merged_post_id: 'merged_feedback_id' }
    if (['image', 'cover', 'published_cover'].includes(field) && typeof child === 'string' && child.startsWith('/') && origin) child = new URL(child, origin).href
    // Preserve arbitrary JSON keys; only the documented merge-record key is translated.
    if (field === 'metadata') {
      const metadata = child && typeof child === 'object' && !Array.isArray(child) ? child as Record<string, unknown> : null
      child = metadata && 'merged_post_id' in metadata ? { ...metadata, merged_feedback_id: metadata.merged_post_id } : child
      if (metadata && child && 'merged_post_id' in metadata) delete (child as Record<string, unknown>).merged_post_id
      return [field, child]
    }
    return [names[field] ?? field, field === 'type' && child === 'mergedPost' ? 'feedback_merged' : toolRecord(child, origin)]
  }))
  return value
}

const summaryFields: Record<string, readonly string[]> = {
  board: ['id', 'name', 'description', 'position', 'createdAt', 'updatedAt', 'deleted'],
  feedback: ['id', 'boardId', 'authorId', 'slug', 'status', 'title', 'excerpt', 'voteCount', 'commentCount', 'mergedTo', 'createdAt', 'updatedAt', 'url', 'deleted', 'sourceId', 'targetId', 'previousPrimaryId'],
  help_collection: ['id', 'name', 'description', 'icon', 'visible', 'position', 'articleCount', 'deleted'],
  help_article: ['id', 'collectionId', 'shortId', 'slug', 'status', 'title', 'description', 'aiEnabled', 'position', 'publishedAt', 'createdAt', 'updatedAt', 'collection', 'url', 'warnings', 'deleted'],
  changelog: ['id', 'authorId', 'slug', 'status', 'title', 'categories', 'cover', 'publishedTitle', 'publishedCategories', 'publishedCover', 'publishedAt', 'createdAt', 'updatedAt', 'url', 'deleted'],
  comment: ['id', 'postId', 'parentId', 'replyToId', 'replyCount', 'likeCount', 'authorId', 'content', 'type', 'metadata', 'editedAt', 'createdAt', 'updatedAt', 'hasLiked', 'author', 'deleted', 'deletedCount'],
  portal_settings: ['portalUrl', 'helpCenterEnabled'],
}
export function writeResult(value: Record<string, unknown>, target?: string) {
  const fields = ['organization_id', 'orgId', ...(summaryFields[target ?? ''] ?? [])]
  return Object.fromEntries(fields.filter(key => key in value).map(key => [key, value[key]]))
}
