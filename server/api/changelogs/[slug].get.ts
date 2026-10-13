import { getPublicChangelog } from '#layers/feedlog/server/services/changelog-queries'

export default defineEventHandler(async (event): Promise<ChangelogListItem> => {
  const session = await getUserSession(event)
  const orgId = event.context.orgId!
  const slug = getRouterParam(event, 'slug')!

  return getPublicChangelog({ db: useDB(), orgId }, slug, session?.user.id)
})
