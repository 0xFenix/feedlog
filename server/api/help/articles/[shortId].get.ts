import { getPublicArticle } from '#layers/feedlog/server/services/help-center-queries'

export default defineEventHandler(async (event) => {
  const orgId = await requireHelpCenterOrg(event)
  const shortId = getRouterParam(event, 'shortId')!.split('-')[0]!

  return getPublicArticle({ db: useDB(), orgId }, shortId)
})
