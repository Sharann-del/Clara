# Testing

Clara has four layers of tests. The first two run anywhere with no AWS account and run in CI on
every push and pull request. The last two need real infrastructure.

| Layer | Needs | Runs in CI |
| --- | --- | --- |
| Unit tests | Node.js | Yes |
| Infrastructure tests (CDK assertions) and `cdk synth` | Node.js | Yes |
| Integration scripts | PostgreSQL, sometimes a Cognito pool or a deployed stack | No |
| End-to-end (Playwright) | A running frontend; a Cognito pool for the signed-in flows | Signed-out flows only |

## Everything CI runs

```bash
npm run lint            # ESLint
npm run format:check    # Prettier
npm run typecheck       # tsc in every package
npm test                # unit tests in every package + CDK assertions
npm run build           # frontend production build
npm run infra:synth     # the stack synthesizes
npm run e2e -w @clara/frontend
```

The workflow is `.github/workflows/ci.yml`. It runs these as parallel jobs on Node 22, builds the
frontend from `packages/frontend/.env.example`, and synthesizes the stack twice: once with the
defaults, and once with every optional feature switched on (NAT gateway, invite-only sign-up,
retained data, an extra origin).

## Unit tests

Written with Node's built-in test runner and run through `tsx`, so there's no build step.

| Command | Covers |
| --- | --- |
| `npm test -w @clara/shared` | DSL and Mermaid parsing, Dagre layout, Mermaid export, SVG rendering, connectors, label wrapping, embeds, diagram diffing |
| `npm test -w @clara/frontend` | Share-link encoding, markdown safety, editor operations, the PDF writer, reconnect backoff, fuzzy search, examples, `next` path validation, time formatting, states |
| `npm test -w @clara/api` | Server SVG export, public-link embed scoping, the sign-up allowlist and invite-code policy |
| `npm test -w @clara/mcp-server` | Element and text edit operations used by the MCP write tools |

Run a single file with `npx tsx --test path/to/file.test.ts`.

## Infrastructure tests

```bash
npm run infra:test
```

Jest assertions against the synthesized CloudFormation template (`packages/infra/test`). They check:

- one VPC that egresses through a single NAT instance, which accepts traffic only from inside the
  VPC and requires IMDSv2;
- the private bucket, CloudFront, single-AZ Postgres and the user pool;
- the MCP route on the shared HTTP API;
- throttling on both API stages and the WebSocket connection-limit wiring;
- every context flag (`natMode=gateway`, both sign-up modes, custom limits, extra origins), and that
  invalid combinations fail at synth time.

Synthesizing needs no AWS credentials.

## Integration scripts

These exercise real services and are run by hand.

### MCP review flow against a local database

```bash
createdb clara_scratch
DATABASE_URL=postgres://localhost/clara_scratch npx tsx packages/mcp-server/scripts/local.ts
```

It applies the migrations, then calls the MCP handler with synthetic API Gateway events. Scripted
assistants propose documents and diagrams; the script accepts, rejects and force-accepts stale
changes, and checks the results. No Cognito needed.

### Sharing and permissions against a running API

```bash
# API running locally (npm run api:dev) against DATABASE_URL, plus ID tokens for two real users
API_URL=http://localhost:3001 TOKEN_A="$TOKEN_A" TOKEN_B="$TOKEN_B" \
DATABASE_URL=postgres://localhost/clara npx tsx packages/mcp-server/scripts/sharing-e2e.ts
```

58 checks covering direct grants in REST and MCP, public links and embed scoping, members and
owner protection, folders and versions. Users A and B must be two different Cognito accounts.
Everything the script creates is deleted at the end.

To create two throwaway users in your own pool and get their tokens:

```bash
POOL=eu-north-1_ExamplePool CLIENT=1example23clientid456abcde
for who in a b; do
  email="clara-test-$who-$(date +%s)@example.com"; pass="Aa1-$(openssl rand -hex 12)"
  aws cognito-idp sign-up --client-id "$CLIENT" --username "$email" --password "$pass" >/dev/null
  aws cognito-idp admin-confirm-sign-up --user-pool-id "$POOL" --username "$email"
  aws cognito-idp initiate-auth --client-id "$CLIENT" --auth-flow USER_PASSWORD_AUTH \
    --auth-parameters "USERNAME=$email,PASSWORD=$pass" --query AuthenticationResult.IdToken --output text
done
```

Delete them afterwards with `aws cognito-idp admin-delete-user`. With `signupMode=allowlist` or
`invite`, create them with `admin-create-user` instead, which the pre-sign-up trigger always allows.

### MCP against a deployed stack

```bash
AWS_PROFILE=clara-admin npm run e2e -w @clara/mcp-server
```

Reads the endpoints from the `ClaraStack` outputs, creates two temporary users, runs the same
scenario over real HTTPS (16 checks, including that a personal access token is rejected by REST and
an ID token by `/mcp`), and deletes the users.

## End-to-end tests (Playwright)

`packages/frontend/e2e/smoke.spec.ts`:

- **Signed out (always runs):** the playground renders as you type, reports a bad line, copies a
  share link and exports a PNG.
- **Signed in (with `E2E_USER_POOL_ID`):** signs up a throwaway account through the real form,
  confirms it with `AdminConfirmSignUp` (there's no inbox to read), checks first-run setup, creates
  a document and a diagram, shares the document publicly, opens the link signed out, revokes it,
  and deletes the account.

```bash
npx playwright install chromium            # once
npm run e2e -w @clara/frontend             # starts the dev server itself

# Against a deployed site, with the signed-in flows:
E2E_BASE_URL=https://d1example2cdn3.cloudfront.net \
E2E_USER_POOL_ID=eu-north-1_ExamplePool AWS_PROFILE=clara-admin \
npm run e2e -w @clara/frontend
```

Without `E2E_BASE_URL`, Playwright starts `npm run dev` (or reuses one already on port 5173). The
throwaway password is random per run. Traces are kept on failure under
`packages/frontend/test-results`, and CI uploads them as an artifact.

## iOS

The iOS app has no automated tests. Check it compiles without signing:

```bash
xcodebuild -project ios/Clara.xcodeproj -scheme Clara \
  -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
```

## Writing tests

- Put unit tests next to the code as `*.test.ts`. The package `test` scripts pick them up.
- Test behaviour through the public function: a parser's output, a renderer's SVG, a service's result.
- Bug fixes should come with a test that fails without the fix.
- New CDK features need an assertion in `packages/infra/test`, including one for each context flag.
