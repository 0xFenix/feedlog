import { sql } from 'drizzle-orm'
import type { ContentContext } from './content-context'

export async function lockFeedback(context: ContentContext) {
  // Merge trees, counters and comment cascades must observe the same organization state.
  await context.db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${context.orgId + ':feedback'}, 0))`)
}
