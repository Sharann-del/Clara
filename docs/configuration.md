# Configuration

Clara is configured in three places:

1. **CDK context**: infrastructure settings for `packages/infra` (NAT, sign-up rules, throttling, limits).
2. **Environment variables**: per package. Deployed Lambdas get theirs from CDK; local development
   reads `.env` files copied from each package's `.env.example`.
3. **The iOS app**: `ios/Clara/Resources/ClaraConfig.json` and `ios/Config/Local.xcconfig`.

None of the account-specific values belong in git. `.env`, `cdk.context.json`, `ClaraConfig.json` and
`Local.xcconfig` are all gitignored, and every one of them has a committed example file.

## CDK context (infrastructure settings)

Set these in `packages/infra/cdk.context.json` (gitignored) or on the command line with
`-c key=value`. Lists can be a JSON array or a comma-separated string. `lib/config.ts` validates
them at synth time, so a bad value fails before anything is deployed.

```json
{
  "natMode": "instance",
  "signupMode": "allowlist",
  "signupAllowlist": ["ada@example.com", "@team.example.net"],
  "apiThrottleRate": 50,
  "apiThrottleBurst": 100,
  "retainData": true
}
```

### Networking and database

| Key | Default | Description |
| --- | --- | --- |
| `natMode` | `instance` | How Lambdas in the private subnets reach AWS APIs. `instance`: one NAT instance (about $7.50/month with its IPv4 address). `gateway`: one managed NAT gateway (about $37/month). See [self-hosting-aws.md](self-hosting-aws.md#costs). |
| `natInstanceType` | `t4g.nano` | EC2 instance type for the NAT instance. The Amazon Linux 2023 image is picked to match its architecture (arm64 for Graviton types, x86_64 otherwise). |
| `dbInstanceType` | `t4g.micro` | RDS instance type, without the `db.` prefix. |
| `dbAllocatedStorageGb` | `20` | RDS storage in GB. Storage autoscaling is off, so this is also the ceiling. |
| `dbMultiAz` | `false` | Run RDS Multi-AZ. Roughly doubles the database cost. |
| `retainData` | `false` | Keep RDS, the Cognito user pool, the DynamoDB table and the S3 bucket on `cdk destroy`, and turn on RDS deletion protection and 7-day backups (1 day otherwise). Turn this on before storing real data. |

### Sign-up restrictions

Off by default: anyone with an email address can create an account. The restrictions are enforced
by a Cognito pre-sign-up Lambda trigger, which is only created when `signupMode` isn't `open`.
Users an administrator creates with `aws cognito-idp admin-create-user` are always allowed.

| Key | Default | Description |
| --- | --- | --- |
| `signupMode` | `open` | `open`, `allowlist` or `invite`. |
| `signupAllowlist` | none | With `allowlist`: exact addresses (`ada@example.com`) and whole domains (`@example.com`), matched case-insensitively. Required in that mode. |
| `signupInviteCodes` | none | With `invite`: accepted codes, matched exactly (case-sensitive, surrounding spaces ignored). Required in that mode. |

With `invite`, also build the frontend with `VITE_SIGNUP_INVITE_REQUIRED=true` (and re-run
`ios/scripts/configure.sh`), so the sign-up form asks for the code. The codes are stored as an
environment variable on the trigger Lambda, readable by anyone in your AWS account who can read
Lambda configuration. To rotate a code, change the list and redeploy.

### Abuse and cost protection

| Key | Default | Description |
| --- | --- | --- |
| `apiThrottleRate` | `50` | Steady-state requests per second across the whole HTTP API (REST and MCP), set on the `$default` stage. Excess requests get HTTP 429 without invoking a Lambda. |
| `apiThrottleBurst` | `100` | Burst capacity for the HTTP API. |
| `wsThrottleRate` | `100` | Steady-state messages per second across the whole WebSocket API. |
| `wsThrottleBurst` | `200` | Burst capacity for the WebSocket API. |
| `wsMaxConnectionsPerUser` | `10` | Open WebSocket connections one user may hold. The app opens one per open document or diagram tab. Over the limit, `$connect` returns 429. |
| `wsMaxConnectionsPerRoom` | `25` | Open WebSocket connections on one document or diagram. |

Keep the Lambda concurrency limit in mind when raising these: on a new account it's often 10,
shared by every function (see [troubleshooting.md](troubleshooting.md#429-or-throttling-errors-under-load)).

### Domains

| Key | Default | Description |
| --- | --- | --- |
| `extraOrigins` | none | Extra browser origins, such as `https://clara.example.com`, added to the HTTP API's CORS allow-list and the Cognito client's callback and logout URLs. The CloudFront URL and `http://localhost:5173` are always included. |

### Account and region

These come from the AWS CLI profile, not from context. The CDK CLI sets `CDK_DEFAULT_ACCOUNT` and
`CDK_DEFAULT_REGION` from the active profile, and `bin/clara.ts` deploys there. Without a region
(which only happens outside the CDK CLI) it falls back to `us-east-1`.

## `@clara/api`

Read from `process.env` by `packages/api/src/config.ts`. Deployed Lambdas get these from CDK. For
local development, copy `packages/api/.env.example` to `.env` and load it (`set -a; . packages/api/.env; set +a`).

| Variable | Default | Used by | Description |
| --- | --- | --- | --- |
| `PORT` | `3001` | Local server | Port for `npm run api:dev`. |
| `DATABASE_URL` | none | Local only | PostgreSQL connection string. When set, it takes precedence over `DB_SECRET_ARN`. Never set in deployed Lambdas. |
| `DB_SECRET_ARN` | none | All Lambdas | Secrets Manager secret with the RDS credentials (`username`, `password`, `host`, `port`), read once per cold start. |
| `DB_NAME` | `clara` | All Lambdas | Database name, if the secret doesn't include `dbname`. |
| `USER_POOL_ID` | none | REST and WebSocket | Cognito user pool whose ID tokens are accepted. Required for sign-in. |
| `USER_POOL_CLIENT_ID` | none | REST and WebSocket | Cognito app client; tokens must have it as their audience. |
| `AWS_REGION` | `eu-north-1` | All | Region for the Secrets Manager, Cognito and DynamoDB clients. Lambda sets it automatically. |
| `CORS_ORIGINS` | `http://localhost:5173` | REST | Comma-separated origins allowed by the API's CORS handler. |
| `CONNECTIONS_TABLE` | none | WebSocket Lambdas | DynamoDB table of open connections. |
| `WS_MANAGEMENT_ENDPOINT` | none | WebSocket Lambdas | `https://…/prod` callback URL used for `postToConnection`. |
| `WS_MAX_CONNECTIONS_PER_USER` | `10` | `$connect` | From `wsMaxConnectionsPerUser`. |
| `WS_MAX_CONNECTIONS_PER_ROOM` | `25` | `$connect` | From `wsMaxConnectionsPerRoom`. |

The pre-sign-up trigger (`src/signup/pre-signup-lambda.ts`) reads `SIGNUP_MODE`,
`SIGNUP_ALLOWLIST` and `SIGNUP_INVITE_CODES`, which CDK sets from the sign-up context values above.

## `@clara/frontend`

Vite reads `VITE_*` variables from `packages/frontend/.env` **at build time** and inlines them into
the JavaScript bundle. They're public by definition: never put a secret in them. Copy
`packages/frontend/.env.example` to `.env`.

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_API_URL` | Yes | REST API base URL: the `ApiUrl` output, or `http://localhost:3001`. |
| `VITE_WS_URL` | For realtime | WebSocket URL: the `WebSocketUrl` output. |
| `VITE_USER_POOL_ID` | Yes | Cognito user pool ID. It must be well-formed (region, underscore, ID, like `eu-north-1_ExamplePool`) even for the public pages, because the Cognito client is created when the app loads. |
| `VITE_USER_POOL_CLIENT_ID` | Yes | Cognito app client ID. |
| `VITE_AWS_REGION` | Yes | The stack's region. |
| `VITE_SITE_URL` | Recommended | Public origin of the site, no trailing slash. Used for absolute Open Graph URLs, `sitemap.xml`, `robots.txt` and the URLs shown in the MCP docs. Without it the sitemap is skipped. |
| `VITE_SIGNUP_INVITE_REQUIRED` | No | `true` shows an invite-code field on the sign-up form. Match it to `signupMode=invite`. |

Playwright reads its own variables from the shell; see [testing.md](testing.md#end-to-end-tests-playwright).

| Variable | Default | Description |
| --- | --- | --- |
| `E2E_BASE_URL` | `http://localhost:5173` | Site under test. When unset, Playwright starts the dev server itself. |
| `E2E_USER_POOL_ID` | none | Enables the signed-in tests. Needs AWS credentials allowed to call `AdminConfirmSignUp` and `AdminDeleteUser` on that pool. |
| `E2E_EMAIL_DOMAIN` | `example.com` | Domain for the throwaway sign-up addresses. |
| `AWS_REGION` | `eu-north-1` | Region of `E2E_USER_POOL_ID`. |

## `@clara/mcp-server`

The deployed MCP Lambda uses only `DB_SECRET_ARN` and `DB_NAME` (as in `@clara/api`, whose database
code it shares). It doesn't need Cognito: callers authenticate with personal access tokens stored in
the database. The integration scripts read the following; see `packages/mcp-server/.env.example`.

| Variable | Used by | Description |
| --- | --- | --- |
| `DATABASE_URL` | `scripts/local.ts`, `scripts/sharing-e2e.ts` | Local database. For the sharing suite, the same one the running API uses. |
| `API_URL` | `scripts/sharing-e2e.ts`, `scripts/e2e.ts` | REST API base URL. |
| `TOKEN_A`, `TOKEN_B` | `scripts/sharing-e2e.ts` | Cognito ID tokens for two different real users. |
| `MCP_URL`, `USER_POOL_ID`, `USER_POOL_CLIENT_ID` | `scripts/e2e.ts` | Deployed endpoints. Unset values are read from the `ClaraStack` outputs. |
| `AWS_REGION`, `AWS_PROFILE` | `scripts/e2e.ts` | Where the stack is, and credentials allowed to admin-confirm and delete Cognito users. |

## `@clara/infra`

Only the CDK CLI's own environment (see `packages/infra/.env.example`): `AWS_PROFILE`, and optionally
`CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION`. Everything else is CDK context, above.

## `@clara/shared`

No configuration. It's a framework-free library imported by the other packages and bundled into
the iOS app.

## iOS app

| File | Committed? | Purpose |
| --- | --- | --- |
| `ios/Config/ClaraConfig.example.json` | Yes | Format reference for the endpoint config |
| `ios/Clara/Resources/ClaraConfig.json` | No (generated) | `apiUrl`, `wsUrl`, `userPoolId`, `userPoolClientId`, `region`, `siteUrl`, `signupInviteRequired`. Written by `ios/scripts/configure.sh` from `packages/frontend/.env`. The app stops at launch with a clear message if it's missing. |
| `ios/Config/Signing.xcconfig` | Yes | Neutral signing defaults (no team, bundle ID `dev.clara.ios`) so the project opens and builds anywhere |
| `ios/Config/Local.example.xcconfig` | Yes | Template for your own signing values |
| `ios/Config/Local.xcconfig` | No | Your `DEVELOPMENT_TEAM` and `PRODUCT_BUNDLE_IDENTIFIER`, included by `Signing.xcconfig` when present |

The keychain service name is derived from the bundle identifier, so two builds with different
bundle IDs never share a session.
