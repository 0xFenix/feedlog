import { boardOverview } from '../../services/boards'

export default defineEventHandler(event => boardOverview({ db: useDB(), orgId: event.context.orgId! }))
