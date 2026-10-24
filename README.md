# Clara

System design documentation that stays in step with the system: markdown documents and
architecture diagrams in one place, diagrams you can write as code (Clara DSL or Mermaid), C4-style
drill-down with no depth limit, named states for walking people through change, real-time
collaboration, and an MCP server so AI assistants can propose edits that a person reviews before
they land.

- Product requirements: [`docs/clara-prd-aws.md`](docs/clara-prd-aws.md)
- AWS architecture, costs and limits: [`docs/aws-report.md`](docs/aws-report.md)
- Every page and API route: [`docs/routes.md`](docs/routes.md)
- User-facing docs ship inside the app at `/docs`

## Repository layout

| Package | What it is |
| --- | --- |
| `packages/frontend` | React + Vite SPA: the public site (landing, playground, docs, pricing, legal) and the signed-in app |
| `packages/api` | Fastify REST API (runs as a Lambda), WebSocket Lambdas, SQL migrations |
| `packages/mcp-server` | MCP server (Lambda on `/mcp`) — reads go through the API's services, writes become pending changes |
| `packages/shared` | Framework-free code used by all three: DSL/Mermaid parsing + Dagre layout, the SVG renderer, diagram diffing, markdown embed parsing, onboarding content |
| `packages/infra` | AWS CDK stack (`ClaraStack`) — see its [README](packages/infra/README.md) |

## The site

Public (no account): `/` landing page with a live editor, `/editor` playground, `/docs/*`,
`/pricing`, `/about`, `/privacy`, `/terms`, and `/s/:token` public share links. Signed in:
`/app` home, `/workspaces/:id`, `/documents/:id`, `/diagrams/:id`, `/settings`, `/settings/tokens`.
Details, including the ⌘K palette and keyboard shortcuts, are in [`docs/routes.md`](docs/routes.md).

Design notes worth knowing before changing the UI:

- Colours are tokens in `packages/frontend/src/styles.css` with light and dark sets. **Amber means
  exactly one thing: a change proposed by an AI that is waiting for a human.** Don't use it for
  anything else.
- The diagram canvas stays a light sheet in both themes, so what you see is what exports.
- Diagrams render through one function, `renderDiagramSvg` in `@clara/shared/render`, used by the
  server's SVG export, client SVG/PNG/PDF export, the playground, embeds and share links.
- Markdown is rendered by `src/lib/markdown.ts`, which escapes raw HTML and filters link/image URLs.
  Documents can be public, so keep it that way.

## Running it locally

Prerequisites: Node 20+, PostgreSQL 16, AWS credentials for the Cognito user pool (the API verifies
real Cognito tokens and looks people up by email).

```bash
npm install

# 1. A local database
createdb clara
export DATABASE_URL=postgres://localhost/clara
npm run api:migrate

# 2. The API (copy packages/api/.env.example for the variable list)
USER_POOL_ID=… USER_POOL_CLIENT_ID=… AWS_REGION=eu-north-1 \
CORS_ORIGINS=http://localhost:5173 DATABASE_URL=$DATABASE_URL npm run api:dev

# 3. The frontend (copy packages/frontend/.env.example to .env first)
VITE_API_URL=http://localhost:3001 npm run frontend:dev
```

The WebSocket handlers only run on AWS and check access against the deployed database, so a
local API has no real-time channel: the app shows "Reconnecting…" and retries with backoff.
Shape edits on the canvas are saved through that channel, so test drawing against the deployed
stack. Documents, code-to-diagram, sharing and everything else save over REST and work locally.

## Tests

| Command | What it covers |
| --- | --- |
| `npm test -w @clara/shared` | DSL/Mermaid parsing, layout, Mermaid export, SVG rendering, connectors, embeds, diffing |
| `npm test -w @clara/frontend` | Share-link encoding, markdown safety, editor operations, PDF writer, backoff, fuzzy search, examples |
| `npm test -w @clara/api` | Server SVG export, public-link embed scoping |
| `npm test -w @clara/mcp-server` | Element and text edit operations |
| `npx tsx packages/mcp-server/scripts/local.ts` | MCP propose → review → accept/reject scenario against a scratch Postgres (`DATABASE_URL`) |
| `npx tsx packages/mcp-server/scripts/sharing-e2e.ts` | Per-item sharing in REST and MCP, public links, members, folders, versions — 58 checks against a running API with two real Cognito users (see the file header) |
| `npm run e2e -w @clara/mcp-server` | MCP against the deployed stack |
| `npm run e2e -w @clara/frontend` | Playwright smoke test (below) |

### End-to-end smoke test

`packages/frontend/e2e/smoke.spec.ts` runs the playground (no account), then signs up a
throwaway user through the real form, checks first-run setup, creates a document and a diagram,
shares the document with a public link, opens it signed out and revokes it. The emailed
verification code is replaced by an `AdminConfirmSignUp` call, and the user is deleted afterwards.

```bash
# frontend running (npm run frontend:dev, or a deployed URL)
E2E_BASE_URL=http://localhost:5173 \
E2E_USER_POOL_ID=eu-north-1_xxxxxxxx AWS_PROFILE=<profile allowed to admin-confirm/delete users> \
npm run e2e -w @clara/frontend
```

Without `E2E_USER_POOL_ID` only the playground test runs. Playwright's Chromium must be
installed (`npx playwright install chromium`).

## Deploying

The backend (API, WebSocket and MCP Lambdas, migrations) deploys with CDK from `packages/infra`;
migrations run automatically on each deploy. The frontend is a static build synced to S3:

```bash
npm run frontend:build      # needs VITE_* vars incl. VITE_SITE_URL (used for sitemap/Open Graph)
aws s3 sync packages/frontend/dist/ s3://<FrontendBucketName>/ --delete
aws cloudfront create-invalidation --distribution-id <FrontendDistributionId> --paths "/*"
```

The frontend tolerates an older backend: onboarding, search and favorites fall back to existing
endpoints, and sharing says it needs the newer API.
