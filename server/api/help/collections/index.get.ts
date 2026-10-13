import { listPublicCollections } from '#layers/feedlog/server/services/help-center-queries'

export default defineEventHandler(async (event) => {
  const orgId = await requireHelpCenterOrg(event)

  return listPublicCollections({ db: useDB(), orgId })
})
