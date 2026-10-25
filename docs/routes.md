# Clara pages and routes

Reference for the web app's pages and the REST API, as of 2026-10-24. Routes marked **new** were
added in the "complete product" work and need the matching backend deploy (migration
`0003_sharing` runs automatically on `cdk deploy`).

## Web pages (`packages/frontend`)

### Public — no account needed

| Path | Page | Notes |
| --- | --- | --- |
| `/` | Landing page | Signed-in visitors are redirected to `/app`. Hero is a working editor with a simulated Claude proposal to accept or reject. |
| `/editor` | Playground | Clara DSL or Mermaid on the left, live diagram on the right. Six examples, SVG/PNG/PDF/Mermaid export, resizable split. State is stored in the URL hash (`#z=` deflate + base64url, `#t=` plain fallback) and a local draft; nothing is sent to a server until **Save to Clara**, which signs in first if needed and returns with `?save=1`. `⌘S` copies the share link. |
| `/docs`, `/docs/:section` | Documentation | Sections: `getting-started`, `dsl`, `mermaid`, `mcp` (includes the `claude mcp add` command with this deployment's URL), `shortcuts`. |
| `/pricing` | Pricing | Free during early access, plus the real fair-use limits from the code. |
| `/about` | About | Includes Clara's own AWS architecture, rendered by Clara. |
| `/privacy`, `/terms` | Legal | Written from what the system actually stores. Review before relying on them. |
| `/signin`, `/signup` | Auth | `?next=<path>` returns there afterwards (same-site paths only). Sign-up sends new accounts to `/app?welcome=1`. |
| `/s/:token` | Public share link | Read-only document (with embedded diagrams) or diagram (with states, present mode and export). `noindex`. |
| anything else | 404 page | CloudFront serves `index.html` for unknown paths, so this is a "soft" 404 (HTTP 200). |

`robots.txt` and `sitemap.xml` are generated at build time from `VITE_SITE_URL`; app routes and
`/s/` are disallowed. `index.html` carries default title, description and Open Graph tags; each
page updates title/description at runtime (`src/lib/seo.ts`).

### Signed in

| Path | Page | Notes |
| --- | --- | --- |
| `/app` | Home | Favorites, recently updated (all workspaces), shared with you, workspaces. Runs first-run setup the first time an account arrives with no workspaces. |
| `/workspaces/:id` | Workspace | Folder tree (rename, move, delete, drag-and-drop, subfolders), filter by name/#tag/kind, sort, tag chips. Row menu: open, favorite, rename, tags, move, share, delete. Members and Pending changes are sub-pages: `/workspaces/:id/members`, `/workspaces/:id/pending`. `?folder=<id>` or `?folder=root` filters; `?tag=` repeats; `?tour=1` starts the tour. |
| `/documents/:id` | Document | Markdown or rich-text editing with a toolbar (headings, bold/italic/code, lists, quote, link, code block, table, image, divider, **Insert diagram**). Saves 600 ms after typing, on `⌘S`, and when leaving. History (diff/preview before restore), Share, tags, favorite, export `.md`. Read-only for viewers and on phones (editors can tap Edit). |
| `/diagrams/:id` | Diagram | Canvas (tools, inline text editing, inspector with colours and drill-down links), Code tab (DSL/Mermaid with live preview, Apply to canvas, Load from canvas), states bar, present mode, Share, Export, History. Read-only viewer for viewers and on phones. |
| `/settings` | Settings | Profile, theme (system/light/dark), password change, sign out. |
| `/documents/:id/share` · `/diagrams/:id/share` | Share | Direct grants and the public link, as a page. |
| `/documents/:id/history` · `/diagrams/:id/history` | Version history | Version list, diff/preview, restore. |
| `/settings/tokens` | Access tokens | Personal access tokens for MCP clients. |
| `/shortcuts` | Keyboard shortcuts | Also opened with `?`. |

Global: **⌘K / Ctrl+K** opens the command palette (search titles and #tags across everything you
can read, plus commands); **?** shows keyboard shortcuts. The full list is in
`src/lib/shortcuts.ts`, rendered both at `/docs/shortcuts` and in the in-app sheet.

## REST API (`packages/api`)

All routes need `Authorization: Bearer <Cognito ID token>` except `/health` and `/public/*`.
"Effective role" means the higher of the caller's workspace role and any direct grant on that item.

### Workspaces and members

| Method and path | Who | |
| --- | --- | --- |
| `GET /workspaces` · `POST /workspaces` | any user | list mine / create (caller becomes owner) |
| `GET /workspaces/:id` | member | includes the caller's `role` |
| `PATCH /workspaces/:id` | admin+ | rename |
| `DELETE /workspaces/:id` | owner | deletes everything in it |
| `GET /workspaces/:id/members` | member | with emails (looked up in Cognito) |
| `POST /workspaces/:id/members` | admin+ | invite by email as `admin`, `editor` or `viewer` (409 if already a member) |
| `PATCH /workspaces/:id/members/:userId` | admin+ | **new** — change role; only owners change owners; the last owner can't be demoted |
| `DELETE /workspaces/:id/members/:userId` | admin+, or yourself | **new** — remove, or leave; never the last owner |

### Folders

| Method and path | Who | |
| --- | --- | --- |
| `GET /workspaces/:id/folders` · `POST …` | viewer+ / editor+ | parent must be in the same workspace |
| `PATCH /folders/:id` | editor+ | rename and/or move; **new** cycle check (not into itself or a descendant) |
| `DELETE /folders/:id` | editor+ | deletes subfolders; documents and diagrams inside move to the top level |

### Documents and diagrams

| Method and path | Who | |
| --- | --- | --- |
| `GET/POST /workspaces/:id/documents` · `…/diagrams` | viewer+ / editor+ | `folderId` must be in the same workspace |
| `GET /documents/:id` · `GET /diagrams/:id` | effective viewer+ | responses now include the effective `role` |
| `PATCH /documents/:id` · `PATCH /diagrams/:id` | effective editor+ | moving between folders needs a workspace role |
| `DELETE /documents/:id` · `DELETE /diagrams/:id` | workspace editor+ | a direct share can edit but not delete |
| `GET /documents/:id/export` | effective viewer+ | markdown file |
| `PUT /diagrams/:id/elements` · `GET/PUT /diagrams/:id/source` | effective editor+ / viewer+ | bulk replace (code apply, import) |
| `GET /diagrams/:id/export?format=svg` | effective viewer+ | shared renderer; attached connectors now draw |
| `GET /diagrams/:id/children` | effective viewer+ | |
| `GET/POST /diagrams/:id/states`, `PUT /diagrams/:id/states/order`, `PATCH/DELETE /diagram-states/:id`, `PUT /diagram-states/:id/overrides/:elementId` | effective viewer+ / editor+ | now honor direct shares |
| `GET /{documents,diagrams}/:id/versions` | effective viewer+ | |
| `GET /{documents,diagrams}/:id/versions/:versionId` | effective viewer+ | **new** — full snapshot, for preview/diff |
| `POST /{documents,diagrams}/:id/versions/:versionId/restore` | effective editor+ | snapshots the current state first |

### Sharing — **new**

| Method and path | Who | |
| --- | --- | --- |
| `GET /{documents,diagrams}/:id/permissions` | effective viewer+ | direct grants, with emails and any workspace role |
| `POST /{documents,diagrams}/:id/permissions` | effective editor+ | `{ email, role: viewer\|editor }` |
| `PATCH /{documents,diagrams}/:id/permissions/:userId` | effective editor+ | change role |
| `DELETE /{documents,diagrams}/:id/permissions/:userId` | effective editor+, or yourself | revoke |
| `GET /{documents,diagrams}/:id/share-links` · `POST …` | viewer+ / editor+ | list active / create a public read-only link |
| `DELETE /share-links/:linkId` | effective editor+ | turn the link off |
| `GET /shared-with-me` | any user | items shared with you directly |

Direct grants are enforced wherever an item is loaded (`assertResourceRole` in
`src/lib/authz.ts`), so they apply to REST, the MCP tools and the WebSocket alike. They don't make
someone a workspace member: they can't list the workspace, move the item between folders, delete
it, or review pending AI changes.

### Public, unauthenticated — **new**

| Method and path | |
| --- | --- |
| `GET /public/:token` | the shared document or diagram (diagrams include states) |
| `GET /public/:token/diagrams/:diagramId` | a diagram embedded in the shared document — only ids the document embeds, same workspace only |
| `GET /public/:token/export.svg` | SVG of a shared diagram |

### Everything else

| Method and path | |
| --- | --- |
| `POST /onboarding` | **new** — first-run setup, at most once per account (`onboarded_users`); idempotent and safe to call concurrently |
| `GET /search?q=&limit=` | **new** — title/tag search over everything you can read; empty `q` = recently updated |
| `GET /favorites` · `PUT/DELETE /favorites/:kind/:id` | **new** — starred items (only readable ones are listed) |
| `GET/POST /tokens`, `DELETE /tokens/:id` | personal access tokens for MCP |
| `GET /workspaces/:id/pending-changes[/count]`, `POST /pending-changes/:id/{accept,reject}` | review AI proposals (workspace editor+) |
| `GET /me`, `GET /health` | |

## WebSocket (`packages/api/src/ws`)

Unchanged protocol, plus `{"action":"ping"}` (**new**): the client sends it every 4 minutes to stay
under API Gateway's 10-minute idle timeout; the server returns without touching DynamoDB. The
client reconnects with exponential backoff (1 s up to 30 s, with jitter), immediately when the
browser comes back online or the tab becomes visible, and refetches the item after a reconnect.
The connection row's TTL is now 2 h 15 min, matching API Gateway's 2-hour connection limit.
