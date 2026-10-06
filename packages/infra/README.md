# @clara/infra

AWS CDK (TypeScript) app that provisions Clara's cloud infrastructure, per
section 6 of the [PRD](../../docs/clara-prd-aws.md).

Milestones 1–4 are deployed to **eu-north-1**: the `Api` construct runs
`@clara/api` as a Lambda behind an HTTP API Gateway, with a deploy-time trigger
that applies the SQL migrations to RDS; the `Realtime` construct adds a
WebSocket API + DynamoDB connections table; the `McpServer` construct adds the
MCP server as a second Lambda on the same HTTP API (`ANY /mcp`).

For the full architecture, request flows, design trade-offs, security review,
cost breakdown and scaling limits, see the
**[AWS architecture report](../../docs/aws-report.md)**. This README is the
short, package-level reference.

## What it provisions

| Construct        | Resource                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `Network`        | One VPC (`10.0.0.0/16`), 2 AZs, public + private subnets, **1 NAT gateway** |
| `Frontend`       | Private S3 bucket + CloudFront distribution (OAC, SPA error routing)    |
| `Compute`        | An **empty** ECS cluster — no services, no cost. Leftover from the original Fargate plan; nothing uses it and it can be deleted |
| `Database`       | RDS PostgreSQL 16, single-AZ **db.t4g.micro**, 20 GB gp3, private, encrypted |
| `Auth`           | Cognito User Pool + web client (email/password)                       |
| `Api`            | `@clara/api` (Fastify) as a Lambda behind an HTTP API Gateway, in the private subnets on `AppSecurityGroup`; a deploy-time `Trigger` Lambda runs the SQL migrations against RDS on every `cdk deploy` |
| `Realtime`       | API Gateway WebSocket API ($connect/$disconnect/$default → 3 Lambdas) + a DynamoDB `Connections` table (PK `connectionId`, GSI `RoomIndex` on `room`), plus a free DynamoDB VPC gateway endpoint |
| `McpServer`      | `@clara/mcp-server` as a Lambda (stateless streamable HTTP) on the existing HTTP API at `ANY /mcp`, in the private subnets; authenticates personal access tokens against RDS and only ever stages writes in `pending_mcp_changes` |

All wired together in a single stack, `ClaraStack` (`lib/clara-stack.ts`).

### Realtime design notes (milestone 2)

- One WebSocket connection per open document/diagram — the client passes
  `?token=<CognitoIdToken>&resourceType=document|diagram&resourceId=<uuid>`
  on the connect URL, since the browser can't set a custom header on a WS
  handshake. `$connect` verifies the token, checks the user's resource role,
  and stores the connection in DynamoDB; `$default` dispatches on an `action`
  field in the message body; `$disconnect` cleans up and broadcasts
  `presence.left`.
- **`$connect` never calls `postToConnection` on its own `connectionId`.**
  API Gateway hasn't finished registering a connection with the Management
  API while its own `$connect` invocation is still running, so a self-post
  there reliably throws `GoneException` — and since the broadcast helper
  treats `GoneException` as "stale connection, prune it," it was silently
  deleting the just-created row within the same request. The client instead
  sends `presence.sync` right after the socket opens, once the connection is
  fully live. This cost a long debugging session to track down — see
  `@clara/api/src/ws/message-lambda.ts` and `connect-lambda.ts` for the full
  writeup in comments.
- Conflict resolution for `diagram_elements` is plain **last-write-wins per
  element** (not a CRDT) — single-row SQL statements per mutation, so
  concurrent edits to *different* elements never conflict, and concurrent
  edits to the *same* element are resolved by whichever UPDATE simply commits
  last in Postgres. Documented in full in `message-lambda.ts`.

### Why Lambda instead of Fargate

The PRD allows either (section 6). The API went to Lambda because building and
pushing a Fargate image needs Docker, which wasn't available in the dev
environment — `aws-lambda-nodejs` bundles with esbuild and needs no container
runtime. The MCP server was then deliberately put on the same HTTP API as a
Lambda rather than a Fargate service: an always-on task plus an ALB would add
fixed monthly cost, whereas the Lambda adds none. Constraints this brings (a
stateless MCP transport, the ~30 s API Gateway integration limit, the account's
Lambda concurrency limit of 10) are covered in the
[report](../../docs/aws-report.md#21-lambda-vs-fargate-and-why-fargate-was-dropped)
and [§5](../../docs/aws-report.md#5-scalability-and-limits).

### Not here yet

- Google OAuth IdP on Cognito — needs real client secrets in Secrets Manager
- ACM cert + custom domain on CloudFront
- Hardening items from the report (separate least-privilege DB role for the MCP Lambda, verified DB TLS, rate limiting, log retention) — see [§3.4](../../docs/aws-report.md#34-secrets-and-the-things-i-would-fix)

## Cost knobs

Everything is tuned to stay cheap for a student project. The dials live in
[`lib/config.ts`](lib/config.ts):

- `natGateways: 1` — one shared NAT instead of one per AZ
- `dbInstanceType: t4g.micro`, `dbMultiAz: false` — the cheapest managed Postgres
  (RDS free-tier eligible only if the account qualifies)
- `retainData: false` — `cdk destroy` tears everything down; no orphaned billable
  resources. **Flip to `true` before storing real data** (it also turns on RDS
  deletion protection and longer backups).

Steady-state estimate for the **eu-north-1 (Stockholm)** deployment, on-demand
list prices from the AWS Pricing API (2026-10-02), 730 h/month, before any free
tier or credits:

| Item                                     | ~ USD / month |
| ---------------------------------------- | ------------- |
| NAT gateway ($0.046/h)                   | 33.58         |
| Public IPv4 for the NAT's Elastic IP ($0.005/h, published rate) | 3.65 |
| RDS db.t4g.micro, single-AZ PostgreSQL ($0.016/h) | 11.68 |
| RDS storage, 20 GB gp3 ($0.12/GB-month)  | 2.40          |
| Secrets Manager, 1 secret                | 0.40          |
| ECS cluster (empty), VPC, subnets, IGW, gateway endpoint, IAM | 0.00 |
| **Fixed total**                          | **≈ $52**     |

Usage-based costs on top (HTTP API $1.06/M requests, Lambda $0.20/M requests +
$0.0000166667/GB-s, DynamoDB on-demand, NAT data $0.046/GB, WebSocket messages,
CloudFront/S3, Cognito) are small for a course project — roughly $0–10/month at
the usage levels in the report. The earlier "~$15–47" figure assumed us-east-1
and a free-tier database; it understated this deployment.

The NAT gateway is about 65% of the fixed bill and the lever worth pulling
first: the private Lambdas need it to reach Secrets Manager, Cognito (JWKS,
`ListUsers`) and the WebSocket management API. Options (NAT instance, interface
endpoints, `cdk destroy` between demos) and their trade-offs are in
[report §4.4](../../docs/aws-report.md#44-how-to-reduce-it).

## Usage

```bash
# from repo root
npm install

# one-time per AWS account/region
npm run bootstrap -w @clara/infra

npm run infra:synth      # synthesize CloudFormation
npm run infra:test       # jest assertions on the synthesized template
npm run deploy -w @clara/infra
npm run destroy -w @clara/infra
```

The region comes from `CDK_DEFAULT_REGION`, which the CDK CLI fills in from your
AWS profile's region (`lib/config.ts` falls back to `us-east-1` only if it is
unset). The live stack is in **eu-north-1**, so make sure your profile or
`CDK_DEFAULT_REGION` says `eu-north-1` before `synth`/`diff`/`deploy`; a different
region would create a second, separate stack.
The account comes from your active AWS credentials (`CDK_DEFAULT_ACCOUNT`).

## Stack outputs

After `deploy`, CloudFormation prints the values the other packages need:
`VpcId`, `AppSecurityGroupId`, `FrontendBucketName`, `FrontendDistributionId`,
`FrontendUrl`, `EcsClusterName`, `EcsClusterArn` (unused cluster), `DbEndpoint`, `DbPort`,
`DbCredentialsSecretArn`, `UserPoolId`, `UserPoolClientId`, `ApiUrl`,
`WebSocketUrl`, `McpUrl`.

`@clara/api`'s `.env` and `@clara/frontend`'s `.env` (see each package's
`.env.example`) are populated from these — re-copy them after a deploy that
changes any of these values.

## Deploying the frontend build

The `Frontend` construct only provisions the S3 bucket + CloudFront
distribution; publishing a build to it is a manual step (also not yet
automated in CI):

```bash
npm run frontend:build   # from repo root — outputs packages/frontend/dist
aws s3 sync packages/frontend/dist/ s3://<FrontendBucketName>/ --delete
aws cloudfront create-invalidation --distribution-id <FrontendDistributionId> --paths "/*"
```
