# Troubleshooting

Problems people commonly hit, grouped by where they show up. If none of these match, open an issue
with the bug report template. Remove tokens, emails and account IDs from any logs first.

## Local development

### The site is blank and the console says "Both UserPoolId and ClientId are required"

The Cognito client is created when the app loads, so the frontend needs well-formed pool values
even for the public pages. Copy `packages/frontend/.env.example` to `packages/frontend/.env` (its
example values are well-formed) and restart `npm run frontend:dev`.

### `ReferenceError: global is not defined` in the dev server

`amazon-cognito-identity-js` expects Node's `global`. `vite.config.ts` defines `global` as
`globalThis` for the dev server. If you see this error, check that the `define` block is still there
and that you started the server with `npm run frontend:dev`.

### Every API call returns 401 locally

- `USER_POOL_ID` and `USER_POOL_CLIENT_ID` in the API's environment must match the pool and client
  the frontend signs in with.
- The API needs `AWS_REGION` set to the pool's region to fetch its signing keys.
- The token must be an **ID token**. Access tokens and `clara_pat_` tokens are rejected by REST.

### CORS errors in the browser console

The API only allows the origins in `CORS_ORIGINS` (local) or the CloudFront URL, `extraOrigins` and
`http://localhost:5173` (deployed). Running the frontend on another port or domain needs adding there.

### The app says "Reconnecting…" all the time

Expected with a local API: the realtime channel only exists on AWS (see
[getting-started.md](getting-started.md#what-works-locally-and-what-doesnt)). Documents and
everything else still save over REST. Against a deployment, check that `VITE_WS_URL` is the
`WebSocketUrl` output, including `/prod`.

### Shapes I draw on the canvas disappear after a reload

Canvas edits save over the WebSocket, so with a local API they aren't persisted. Use the Code tab
(saved over REST) or test against a deployed stack.

### `npm run api:migrate` fails with "DB_SECRET_ARN is not set and no DATABASE_URL fallback was provided"

Export `DATABASE_URL` in the same shell, or load `packages/api/.env` first
(`set -a; . packages/api/.env; set +a`).

### Postgres won't start: "Unix-domain socket path … is too long"

The socket path limit is 103 bytes. Start the server with a shorter data directory, or TCP only,
for example `pg_ctl -D ~/pgdata/clara -o "-p 5433 -c unix_socket_directories=''" start`, then
connect with `postgres://clara@localhost:5433/clara`.

### Playwright: "Executable doesn't exist" or a browser version mismatch

Run `npx playwright install chromium` inside `packages/frontend`. If port 5173 is taken by another
process, stop it or set `E2E_BASE_URL` to the server you want to test.

## Deploying

### `cdk deploy` says the environment isn't bootstrapped

Run `npm run bootstrap -w @clara/infra` once for the account and region in your profile.

### The deploy went to the wrong region, or created a second stack

The CDK takes the region from your AWS profile (`CDK_DEFAULT_REGION`). Check
`aws configure get region` before `diff` or `deploy`. A different region creates a separate
`ClaraStack`.

### Synth fails with "signupMode=invite needs at least one code…"

A restricted sign-up mode needs something to check against. Set `signupInviteCodes` (for `invite`)
or `signupAllowlist` (for `allowlist`) in `packages/infra/cdk.context.json` or with `-c`. See
[configuration.md](configuration.md#sign-up-restrictions).

### Deploy fails on the NAT instance: "The specified instance type is not eligible for Free Tier"

Accounts on the AWS Free plan can only launch Free Tier eligible instance types. The default
`natInstanceType` is `t4g.micro`, which is eligible. If you set another type, list the allowed ones
and pick an ARM (`arm64`) one:

```bash
aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true \
  --query 'InstanceTypes[].[InstanceType,ProcessorInfo.SupportedArchitectures[0]]' --output table
```

CloudFormation rolls the stack back, so deploy again after changing the setting.

### The migration trigger fails during deploy

The `MigrateFn` Lambda's CloudWatch log group has the SQL error. Fix the migration, or the data it
tripped over, and deploy again; the trigger runs on every deploy and skips migrations already in
`schema_migrations`. Never edit a migration that has already run on a deployment; add a new one.

### Deploy fails on the NAT instance: "Failed to receive 1 resource signal(s)" or a FAILURE signal

The NAT instance reports to CloudFormation when its setup script finishes. A FAILURE signal means a
step failed (package install, IP forwarding, the MASQUERADE rule or the egress check); no signal
within 10 minutes usually means the instance couldn't reach the internet to install packages or
send the signal. Either way the private routes were never switched, so the app keeps its previous
egress. To see which step failed, read the instance's console output before the rollback deletes
it:

```bash
ID=$(aws ec2 describe-instances --filters Name=tag:Name,Values='ClaraStack/Network/Vpc/publicSubnet1/NatInstance' \
  --query 'Reservations[].Instances[].InstanceId' --output text)
aws ec2 get-console-output --instance-id "$ID" --latest --output text | grep -A3 -E '^\+|error|fail'
```

The script runs with `set -x`, so each command is echoed with a leading `+`. To deploy anyway with
the managed option, use `-c natMode=gateway`.

### Lambdas time out on cold start after changing the NAT

The private Lambdas reach Secrets Manager and Cognito through the NAT. If they time out:

- check the NAT instance is running (`aws ec2 describe-instances --filters Name=tag:Name,Values='ClaraStack/Network/Vpc/publicSubnet1/NatInstance'`);
- check the private subnets' default route points at it (`aws ec2 describe-route-tables`);
- if it was stopped or replaced by hand, run `npm run deploy -w @clara/infra` to restore it;
- or switch to the managed option with `-c natMode=gateway`.

## Signing up and signing in

### No verification email arrives

Cognito's built-in sender is limited to 50 emails a day per account and often lands in spam. Check
the spam folder and resend from the sign-up page. For real use, configure the user pool to send
through Amazon SES. An operator can also confirm an account by hand:
`aws cognito-idp admin-confirm-sign-up --user-pool-id eu-north-1_ExamplePool --username ada@example.com`,
using your own `UserPoolId` output and the person's email.

### "Sign-ups are limited to approved email addresses" or "That invite code isn't valid"

The deployment uses `signupMode=allowlist` or `invite`. Ask the operator to add your address or
give you a code. Operators can add people directly with `aws cognito-idp admin-create-user`, which
the trigger always allows.

### The invite-code field doesn't appear on the sign-up form

The frontend was built without `VITE_SIGNUP_INVITE_REQUIRED=true`. Rebuild and upload it; for iOS,
re-run `ios/scripts/configure.sh`.

## Realtime

### 429 or throttling errors under load

Three limits can cause this:

1. **The stage throttles** (`apiThrottleRate`, `wsThrottleRate` and their bursts). API Gateway
   returns 429 without invoking anything.
2. **WebSocket connection limits.** More than `wsMaxConnectionsPerUser` open tabs, or more than
   `wsMaxConnectionsPerRoom` people on one item, gets `$connect` rejected with 429.
3. **Lambda concurrency.** New accounts often have a limit of 10 concurrent executions shared by
   every function. Check it with `aws lambda get-account-settings` and request an increase in
   Service Quotas (Lambda → Concurrent executions).

### Other people's edits don't appear until I reload

Canvas edits, Code tab applies and version restores are pushed to everyone viewing the diagram.
An **accepted AI change** is saved over REST from the Pending changes page, which has no socket
for that diagram, so people who already have it open see the change after a reload. This is a
known gap (see the [roadmap](roadmap.md)). Anything broadcast while a connection was down is
refetched automatically when it reconnects.

## MCP

| Symptom | Cause and fix |
| --- | --- |
| `401` with `WWW-Authenticate: Bearer realm="clara-mcp"` | The token is missing, mistyped, expired or revoked. Create a new one under Settings → Access tokens. |
| `405 Method not allowed` | The client tried `GET` (SSE) or `DELETE`. Clara's server is stateless and only answers `POST`; use a client that supports streamable HTTP with JSON responses. |
| `406 Not Acceptable` | The request didn't send `Accept: application/json, text/event-stream`. |
| A tool returns "Editor role required" | The token's owner is a viewer in that workspace. Viewers can read but not propose. |
| "50 changes are already awaiting review" | Review or reject the open proposals under Pending changes first. |
| Accept returns 409 | The item changed after the proposal. Review the diff against the current version, then force or reject it. |
| claude.ai won't add Clara as a connector | claude.ai custom connectors need OAuth, which Clara doesn't implement yet. Use Claude Code or `mcp-remote` (see [mcp-setup.md](mcp-setup.md)). |

## iOS

### The app crashes at launch with "Missing Resources/ClaraConfig.json"

Run `ios/scripts/configure.sh` (it reads `packages/frontend/.env`) and build again.

### Xcode says signing requires a development team

Copy `ios/Config/Local.example.xcconfig` to `ios/Config/Local.xcconfig`, set your team ID and a
bundle identifier you own, and reopen the project.

### Installing on a device fails with a limit on apps

Free Apple developer accounts can install at most 3 sideloaded apps per device. Remove one, and
trust the developer under Settings → General → VPN & Device Management on first launch.
