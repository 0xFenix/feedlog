# Content services

Web APIs and MCP tools call the same domain services. The adapters retain their existing authentication methods and response formats; domain services own organization scoping, content rules and database queries. No schema migration is required for this separation.

| Domain | Service modules | Shared behavior |
| --- | --- | --- |
| Boards | `server/services/boards.ts` | CRUD, ordering, counts excluding merged children; the Web overview also counts unassigned feedback |
| Feedback | `feedback.ts`, `feedback-queries.ts`, `feedback-web-queries.ts` | CRUD, merge trees, vote counters, shared filters and explicit fields; Web views add viewer-specific votes, subscriptions and authorized source details |
| Comments | `comments.ts`, `comment-threads.ts` | Authorship, replies, likes and counters; flat paginated records and threaded Web views |
| Help Center | `help-center.ts`, `help-center-queries.ts` | Collection/article lifecycle, management reads and public visibility; both article detail adapters use `articleRecord` |
| Changelogs | `changelogs.ts`, `changelog-queries.ts` | Editable content and published snapshots; shared management detail and status filters |
| Portal settings | `portal-settings.ts` | Effective settings, organization permission checks, metadata preservation and cache invalidation |

## Adapter responsibilities

- Web routes read and validate HTTP inputs, authenticate the current session, resolve the active organization and choose the response status. Offset pagination, cursor encoding and response envelopes remain compatible with existing callers.
- `server/mcp/tools.ts` registers tools, translates snake_case inputs and delegates business operations. It contains no business SQL.
- `server/mcp/execute.ts` checks the live OAuth grant and membership, invokes the operation and records activity and audits. Organization and membership locks remain held through the business operation so revocation cannot be bypassed by a concurrent request.
- `server/mcp/output.ts` formats UTC timestamps, absolute media URLs, field names and compact write summaries. Explicit field selections and write allowlists keep new database columns out of tool responses. Free-form metadata keys are retained, except for the documented merge-record identifier mapping.

Domain services use `ContentReader` for scoped reads and `ContentContext` for writes. They accept normalized inputs rather than HTTP events or MCP request objects. Public and management queries remain distinct where their visibility or projections differ. Existing specialized text/semantic search helpers are reused; pagination helpers do not select business tables.

## Transactions and audit failures

Web writes enter through `contentTransaction`. MCP operations enter through `executeMcpOperation`. Both provide the same database transaction and actor context to domain services. Merge trees, counters and cascading deletes remain atomic. Notifications and cache invalidation are scheduled only after commit.

Successful MCP audits are written after the business commit. If that audit insert fails, the server logs the operation and consent identifier and still returns the successful business result. The audit is best effort: a process crash between commit and audit can leave a missing audit row. Failed business operations roll back and attempt a separate failure audit. Authorization and revocation audit behavior is unchanged.

## Pagination and dates

`query-pagination.ts` supplies filter-bound cursor validation, stable sorting by value plus ID, and database-precision timestamp keys. `web-pagination.ts` retains the existing Web cursor encoding. Web offset lists retain their established sorting and search behavior; MCP lists retain their documented substring search and filters.

Query results use typed Drizzle columns rather than whole-row PostgreSQL JSON conversion. Result dates therefore follow the same UTC serialization path for lists and details. Cursor timestamps are selected separately with six fractional digits to avoid skipping records within the same millisecond. Existing MCP cursor fingerprints are preserved.

Comment defaults are unchanged: the MCP detail preview contains the latest five in descending order, while the comment list defaults to ascending order. Continue a preview cursor with `sort: created_desc`. Web thread views preserve their requested top-level order and chronological replies.

## Regression coverage

`tests/mcp.integration.test.ts` exercises the 36 tools against a real server and isolated database, with Web/MCP cross-checks for boards, feedback, comments, help articles and changelogs. Cases include owner/manager/contributor permissions, organization isolation, publication visibility, snapshots, null boards, merged-feedback counts, cursor filters, microsecond pagination and audit failure after commit. `tests/mcp.output.test.ts` checks output projection without a server.

See [MCP local validation](mcp.md#local-validation) for environment variables. Run the application's host-routing tests as well when consuming FeedLog as a layer.
