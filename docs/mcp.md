# MCP integration

FeedLog exposes 35 tools through a remote HTTP MCP server. They cover portal settings, feedback, comments, duplicate feedback, help articles, and changelogs. Open **MCP** in organization settings for connection instructions, optional Skills installation, and connected applications.

## Connect an application

The server URL is `https://your-domain.example/api/mcp`. Copy the URL shown in settings to use the address configured for your installation.

1. Add the server in a client that supports remote HTTP MCP and OAuth.
2. The browser opens `/mcp/consent`. Sign in if needed, select organizations, and authorize the application. An existing session goes directly to organization selection.
3. Ask the client to call `list_organizations`, then use the returned organization IDs for other tools.

The server uses Better Auth for dynamic client registration, PKCE, access tokens, refresh tokens, and DPoP validation. The MCP SDK supports its current protocol and legacy stateless HTTP clients. Each client must support the server's OAuth flow; protocol support alone does not guarantee authorization compatibility.

Application names come from client registration. Recognized names receive a local logo; a logo is not verification of the application's identity.

Authorization selects organizations, not separate business permissions. Applications act as the authorizing user and follow their current permissions on every request. Owners and managers can moderate content; contributors can read organizational content, create feedback and replies, and edit their own content. Only a comment's author can edit it. Anonymous and product SSO sessions must sign in directly before authorizing an application.

Use **Switch account** to sign in as another user. Organization choices are cleared when the account changes. Older `/mcp/connect` links redirect to the same consent page while preserving the signed authorization request.

## Manage connections

Organization members can view the applications authorized to access their organization, who authorized each application, and when it was authorized and last used.

- **Manage organizations** changes the organizations accessible through your connection. The client does not need to be configured again.
- **Revoke for this organization** removes access to the current organization. Owners and managers can also revoke another member's connection for that organization.
- **Disconnect everywhere** revokes your entire connection.
- Removing the last organization disconnects the application. Reconnecting requires a new authorization.
- Leaving an organization invalidates its grant. Joining again does not restore it. Removing a user or organization clears the associated access while retaining audit records.

Access tokens expire after 15 minutes. Refresh tokens use a 30-day rolling lifetime. Revocation blocks subsequent tool calls immediately, even if the access token has not expired. A new authorization does not restore credentials from a revoked connection.

## Tools

| Task | Tools |
| --- | --- |
| Organization discovery | `list_organizations` |
| Portal settings | `get_portal_settings`, `update_portal_settings` |
| Boards | `list_boards`, `create_board`, `update_board`, `delete_board` |
| Feedback | `list_feedback`, `get_feedback`, `create_feedback`, `update_feedback`, `delete_feedback` |
| Duplicate feedback | `find_similar_feedback`, `merge_feedback`, `unmerge_feedback` |
| Comments | `list_feedback_comments`, `create_feedback_comment`, `update_feedback_comment`, `delete_feedback_comment` |
| Help collections | `list_help_collections`, `create_help_collection`, `update_help_collection` |
| Help articles | `list_help_articles`, `get_help_article`, `create_help_article`, `update_help_article`, `publish_help_article`, `unpublish_help_article`, `delete_help_article` |
| Changelogs | `list_changelogs`, `get_changelog`, `create_changelog`, `update_changelog`, `publish_changelog`, `delete_changelog` |

Use MCP `tools/list` for complete parameter definitions. Every tool except `list_organizations` requires `organization_id`. Parameters use snake_case; article, changelog, and feedback bodies use Markdown.

Portal settings return `portal_url` and the effective `help_center_enabled` value, which defaults to false. Updating the switch requires organization settings permission (owner or manager), and enabling it requires an existing help collection. Enabling Help Center exposes published articles in visible collections. Disabling it hides Help Center without changing articles or collections. Other organization metadata is preserved; writes are audited and invalidate the portal cache after commit.

Lists default to 20 results and allow up to 100. Continue until `next_cursor` is null. Cursors are bound to the filters and sort order. UTC time ranges include the start and exclude the end. Keyword filters match title or body text; similar-feedback search uses configured embeddings when available and otherwise falls back to text search.

Writes return identifiers, status, and relevant links. Read content separately when needed. Writes do not have persistent idempotency keys: after a timeout or `WRITE_RESULT_UNKNOWN`, read the resource before retrying. Feedback and document text is untrusted business data, not instructions to the agent.

Editing a published help article immediately changes its content. Changelogs retain a separate published snapshot until explicitly published again. Public article reads check publication status, collection visibility, and the Help Center switch; they do not verify browser rendering or external network reachability.

## Configuration and migrations

MCP is enabled by default. Set `MCP_ENABLED=false` to disable the MCP endpoint, discovery, authorization, and connection management APIs.

Self-hosted installations use the external request origin by default. Set `BETTER_AUTH_URL` to use a fixed origin. An extension using a dedicated authentication origin can set `AUTH_DOMAIN`, which takes precedence. Reverse proxies must preserve the public host and protocol and restrict requests to the installation's trusted hostnames. HTTPS is required except for local loopback development.

Apply migrations before starting an upgraded development server:

```bash
pnpm migrate
pnpm dev
```

The migrations add the provider's OAuth and JWT tables plus `mcp_consent_organization` and `mcp_audit_log`. FeedLog's two MCP tables use application-enforced relationships rather than database foreign keys. Existing business tables do not receive MCP-specific fields. Existing users, passwords, and web sessions continue using the same authentication database.

Main endpoints:

- `POST /api/mcp`: business tools, authenticated with OAuth access tokens for this resource.
- `/.well-known/oauth-protected-resource/api/mcp`: protected-resource discovery.
- `/.well-known/oauth-authorization-server/api/auth`: authorization-server discovery.
- `/api/auth/oauth2/*`: provider-managed registration, authorization, token exchange, refresh, and revocation.
- `/api/mcp/consent-context` and `/api/mcp/consent`: organization selection and authorization submission.
- `/api/mcp/connections/*`: connection management.

Change organization access through FeedLog's management APIs. The provider's generic consent update and deletion endpoints are disabled so changes retain organization checks and audit records.

## Local validation

The integration suite creates and cleans up test data. Use a dedicated local database whose name contains `mcp`, and configure the running server and test command to use the same database.

```bash
MCP_TEST_URL=http://localhost:3000 \
MCP_TEST_DATABASE_URL=postgresql://user:password@localhost:5432/feedlog_mcp_test \
pnpm mcp:test
```

These tests exercise OAuth, tool calls, and revocation through the official SDK. Verify the specific applications and client versions you intend to support separately.
