# API

Clara exposes three interfaces from one deployment:

| Interface | URL | Auth | Reference |
| --- | --- | --- | --- |
| REST API | `ApiUrl` output (for example `https://a1b2c3d4e5.execute-api.eu-north-1.amazonaws.com`) | Cognito ID token | This page and [routes.md](routes.md) |
| MCP server | `McpUrl` output (`ApiUrl` + `/mcp`) | Personal access token | [mcp-setup.md](mcp-setup.md) |
| Realtime WebSocket | `WebSocketUrl` output (`wss://…/prod`) | Cognito ID token in the query string | [realtime.md](realtime.md) |

Locally, the REST API runs on `http://localhost:3001` (`npm run api:dev`).

## Authentication

Every route except `GET /health` and `GET /public/*` needs a Cognito **ID token** (not the access
token):

```http
GET /workspaces HTTP/1.1
Authorization: Bearer eyJraWQiOiJ...
```

The API checks the signature against the pool's JWKS, the issuer, expiry, `token_use = id` and that
the audience is the configured app client. ID tokens last one hour; the web app refreshes them
with the refresh token. A personal access token (`clara_pat_…`) is rejected by REST, and an ID
token is rejected by `/mcp`.

To get a token from the command line, for scripting against your own deployment (the app client
allows `USER_PASSWORD_AUTH`):

```bash
aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH \
  --client-id 1example23clientid456abcde \
  --auth-parameters USERNAME=ada@example.com,PASSWORD='Correct-horse-battery-9' \
  --query 'AuthenticationResult.IdToken' --output text
```

Use your own client ID and account; the values above are examples.

## Requests and responses

- Request bodies are JSON (`Content-Type: application/json`) and are validated with Zod.
- Responses are JSON. Rows are returned with the database's snake_case column names (`content_md`,
  `workspace_id`, `updated_at`); request bodies use camelCase (`contentMd`, `folderId`).
- `201` for creates, `204` for deletes, `200` otherwise.
- IDs are UUIDs; timestamps are ISO 8601 in UTC.

### Errors

Errors always have an `error` message, and validation errors add the Zod `issues`:

```json
{ "error": "Invalid request body", "issues": [{ "path": ["name"], "message": "String must contain at least 1 character(s)" }] }
```

| Status | Meaning |
| --- | --- |
| `400` | Invalid body or parameters |
| `401` | Missing, invalid or expired token |
| `403` | Authenticated, but your role is too low (`"Editor role required"`) or you have no access |
| `404` | Not found |
| `409` | Conflict: already a member, or a pending change is stale (see below) |
| `429` | Over the API's throttle (`apiThrottleRate` / `apiThrottleBurst`) |
| `500` | Unexpected server error |

## Permissions

"Effective role" is the higher of your workspace role and any direct grant on the item. Reading
needs `viewer`, writing needs `editor`, member management needs `admin` and deleting a workspace
needs `owner`. A direct grant lets someone edit an item but not delete it, move it between folders
or review its pending AI changes. [sharing-and-permissions.md](sharing-and-permissions.md) has the
full rules.

## Examples

All examples assume `TOKEN` holds an ID token and `API` the base URL.

Create a workspace (you become its owner):

```bash
curl -s -X POST "$API/workspaces" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Platform"}'
```

Create a document in it:

```bash
curl -s -X POST "$API/workspaces/$WORKSPACE_ID/documents" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Checkout flow","contentMd":"# Checkout\n\nHow an order moves through the system.","tags":["payments"]}'
```

Edit it (only the fields you send change; the previous version is snapshotted):

```bash
curl -s -X PATCH "$API/documents/$DOCUMENT_ID" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"contentMd":"# Checkout\n\nUpdated after the CDN rollout."}'
```

Save a diagram's Code tab source, then export the diagram as SVG. Saving source stores the text
only. The web app lays it out with `@clara/shared` and saves the resulting shapes with
`PUT /diagrams/:id/elements` (`{"elements": [...]}`), so the canvas and the code stay in step.

```bash
curl -s -X PUT "$API/diagrams/$DIAGRAM_ID/source" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"dslText":"node web \"Web\"\nnode api \"API\"\nedge web -> api \"HTTPS\"","format":"clara"}'

curl -s "$API/diagrams/$DIAGRAM_ID/export?format=svg" -H "Authorization: Bearer $TOKEN" -o diagram.svg
```

Create a personal access token for an MCP client (`expiresInDays` is 1–365, or `null` for never;
the default is 90):

```bash
curl -s -X POST "$API/tokens" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Claude Code on my laptop","expiresInDays":30}'
```

The response includes the token once. Clara stores only its SHA-256 hash.

Review AI proposals in a workspace:

```bash
curl -s "$API/workspaces/$WORKSPACE_ID/pending-changes" -H "Authorization: Bearer $TOKEN"
curl -s -X POST "$API/pending-changes/$CHANGE_ID/accept" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
```

If the item changed after the proposal was made, accept returns `409`. Look at the diff against the
current version, then send `{"force": true}` to apply it anyway, or reject it with
`POST /pending-changes/:id/reject`.

## Route reference

[routes.md](routes.md) lists every REST route with the role it needs, along with the web app's pages
and the WebSocket additions. Grouped summary:

| Group | Routes |
| --- | --- |
| Workspaces and members | `/workspaces`, `/workspaces/:id`, `/workspaces/:id/members[/:userId]` |
| Folders | `/workspaces/:id/folders`, `/folders/:id` |
| Documents | `/workspaces/:id/documents`, `/documents/:id`, `/documents/:id/export` |
| Diagrams | `/workspaces/:id/diagrams`, `/diagrams/:id`, `/diagrams/:id/elements`, `/diagrams/:id/source`, `/diagrams/:id/export`, `/diagrams/:id/children` |
| States | `/diagrams/:id/states`, `/diagrams/:id/states/order`, `/diagram-states/:id`, `/diagram-states/:id/overrides/:elementId` |
| Versions | `/{documents,diagrams}/:id/versions[/:versionId[/restore]]` |
| Sharing | `/{documents,diagrams}/:id/permissions[/:userId]`, `/{documents,diagrams}/:id/share-links`, `/share-links/:linkId`, `/shared-with-me` |
| Public | `/public/:token`, `/public/:token/diagrams/:diagramId`, `/public/:token/export.svg` |
| AI review | `/workspaces/:id/pending-changes[/count]`, `/pending-changes/:id/{accept,reject}` |
| Account | `/me`, `/tokens[/:id]`, `/onboarding`, `/search`, `/favorites[/:kind/:id]` |
| Health | `/health` |

## Limits

| Limit | Value | Where |
| --- | --- | --- |
| HTTP API throughput | 50 requests/s steady, 100 burst (configurable) | API Gateway stage |
| Lambda timeout | 20 s REST, 25 s MCP | CDK |
| Response size | about 6 MB (Lambda's synchronous payload limit) | AWS |
| Server-side export | SVG only; PNG and PDF are produced in the browser | `routes/diagrams.ts` |
| Workspace name | 1–200 characters | `routes/workspaces.ts` |
| Document title | 1–300 characters | `routes/documents.ts` |
| Active personal access tokens | 20 per user | `lib/tokens.ts` |
| Pending AI proposals | 50 open per user per workspace | `lib/pending.ts` |
| AI-proposed document body | 500,000 characters | `lib/pending.ts` |
| AI-proposed diagram | 1,000 elements | `lib/pending.ts` |
