import { eq } from 'drizzle-orm'
import { helpCollection, organization } from '../db/schemas'
import { roles } from '../../shared/auth/permissions'
import { parseOrgMetadata } from '../../shared/utils/branding'
import { resolvePortalModules } from '../../shared/utils/portal-modules'
import { invalidateOrgInfo } from '../utils/org-cache'
import { buildPostLink } from '../utils/post-link-builder'
import { contentError, type ContentContext } from './content-context'

function settings(context: ContentContext, org: { slug: string; metadata: string | null }) {
  return {
    portalUrl: buildPostLink(org.slug, '/', context.origin),
    helpCenterEnabled: resolvePortalModules(org.metadata).helpCenter,
  }
}

export async function getPortalSettings(context: ContentContext) {
  const [org] = await context.db.select({ slug: organization.slug, metadata: organization.metadata })
    .from(organization).where(eq(organization.id, context.orgId))
  if (!org) throw contentError(404, 'Organization not found')
  return settings(context, org)
}

export async function updatePortalSettings(context: ContentContext, helpCenterEnabled: boolean) {
  const role = roles[context.role as keyof typeof roles]
  if (!role?.authorize({ organization: ['update'] }).success) {
    throw contentError(403, 'Organization settings permission is required')
  }
  const [org] = await context.db.select({ slug: organization.slug, metadata: organization.metadata })
    .from(organization).where(eq(organization.id, context.orgId)).for('update')
  if (!org) throw contentError(404, 'Organization not found')
  if (helpCenterEnabled) {
    const [collection] = await context.db.select({ id: helpCollection.id }).from(helpCollection)
      .where(eq(helpCollection.orgId, context.orgId)).limit(1)
    if (!collection) throw contentError(400, 'Create a help collection before enabling Help Center')
  }
  const metadata = parseOrgMetadata(org.metadata)
  const modules = metadata.portalModules
  const updated = JSON.stringify({
    ...metadata,
    portalModules: {
      ...(modules && typeof modules === 'object' && !Array.isArray(modules) ? modules : {}),
      helpCenter: helpCenterEnabled,
    },
  })
  await context.db.update(organization).set({ metadata: updated }).where(eq(organization.id, context.orgId))
  context.afterCommit.push(() => invalidateOrgInfo(org.slug))
  return settings(context, { ...org, metadata: updated })
}
