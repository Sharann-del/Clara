# Getting started

This guide gets Clara running on your machine: first the public site and playground, which need
nothing but Node.js, then the full signed-in app with a local API and database.

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 22 or later | Everything |
| npm | 10 or later (ships with Node 22) | Everything |
| PostgreSQL | 16 | The local API |
| An AWS account and the AWS CLI v2 | | A Cognito user pool for sign-in, and anything realtime |
| Xcode | 16 or later | Only the iOS app |

## 1. Install

```bash
git clone https://github.com/Sharann-del/Clara.git
cd Clara
npm install
```

The repository is an npm workspace, so this one install links `@clara/shared` into the other
packages.

## 2. The public site and playground

```bash
cp packages/frontend/.env.example packages/frontend/.env
npm run frontend:dev
```

Open <http://localhost:5173>. The landing page, the playground at `/editor` and the docs at
`/docs` all run in the browser. The example values in `.env` are well-formed but point at nothing,
so signing in won't work yet.

Try the playground with some Clara DSL:

```
direction LR
node browser "Browser"
node api "Orders API"
node db "Postgres"
edge browser -> api "HTTPS"
edge api -> db "SQL"
group backend "Backend" { api db }
```

Or paste Mermaid (`flowchart LR` / `graph TD`). The full syntax is in the app at `/docs/dsl` and
`/docs/mermaid`.

## 3. The full app, locally

The signed-in app needs three things: a Cognito user pool (the API checks real Cognito tokens), a
PostgreSQL database and the API itself.

### A user pool

The simplest option is to deploy the stack once ([Self-hosting on AWS](self-hosting-aws.md)) and
use its `UserPoolId` and `UserPoolClientId` outputs. The deployed client already allows
`http://localhost:5173`.

### A database

```bash
createdb clara
export DATABASE_URL=postgres://localhost/clara
npm run api:migrate
```

`api:migrate` applies every migration in `packages/api/src/migrations/` in order and records them
in a `schema_migrations` table, so it's safe to run again.

### The API

```bash
cp packages/api/.env.example packages/api/.env
# Edit packages/api/.env: set DATABASE_URL, USER_POOL_ID, USER_POOL_CLIENT_ID and AWS_REGION.
set -a; . packages/api/.env; set +a
npm run api:dev
```

The API listens on <http://localhost:3001>. `curl localhost:3001/health` should return
`{"status":"ok"}`. Inviting members looks people up with Cognito's `ListUsers`, so that one feature
also needs AWS credentials allowed to call it.

### Point the frontend at it

Edit `packages/frontend/.env`. Set the API to the local one, and replace the example pool values
with your stack's `UserPoolId` and `UserPoolClientId` outputs and its region:

```bash
VITE_API_URL=http://localhost:3001
VITE_USER_POOL_ID=eu-north-1_ExamplePool
VITE_USER_POOL_CLIENT_ID=1example23clientid456abcde
VITE_AWS_REGION=eu-north-1
```

Restart `npm run frontend:dev` and create an account at `/signup`. Cognito emails a verification
code; after you enter it, Clara sets up a first workspace with a sample document and diagram.

## What works locally and what doesn't

| Works with a local API | Needs the deployed stack |
| --- | --- |
| Documents, folders, tags, search, favorites | Live cursors, presence and live typing |
| Diagrams from code, Mermaid import, export | Saving shape edits made on the canvas |
| Sharing, public links, members, version history | |
| Access tokens and Pending changes review | |

The realtime channel runs on API Gateway's WebSocket API and its Lambdas, which have no local
equivalent. Without it the app shows "Reconnecting…" and retries with backoff. Canvas shape edits
are saved over that channel (see [realtime.md](realtime.md)), so test drawing against a deployment.
Everything that saves over REST works locally, including Code tab edits.

To use the deployed WebSocket API with a local frontend, set `VITE_WS_URL` to the `WebSocketUrl`
output. It checks access against the deployed database, so it only works for items that exist
there.

## 4. Run the checks

```bash
npm run lint
npm run typecheck
npm test
```

[testing.md](testing.md) covers the integration scripts and the Playwright suite.

## Next steps

- [Self-hosting on AWS](self-hosting-aws.md): deploy your own copy
- [Configuration](configuration.md): every environment variable and CDK setting
- [MCP setup](mcp-setup.md): connect Claude Code to your Clara
- [Architecture](architecture.md): how the pieces fit together
