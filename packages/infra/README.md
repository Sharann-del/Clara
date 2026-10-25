# @clara/infra

AWS CDK (TypeScript) app that provisions all of Clara's cloud infrastructure as one stack,
`ClaraStack` (`lib/clara-stack.ts`). The step-by-step deployment guide is
[docs/self-hosting-aws.md](../../docs/self-hosting-aws.md), every setting is in
[docs/configuration.md](../../docs/configuration.md#cdk-context-infrastructure-settings), and the
design trade-offs, security review, costs and scaling limits are in the
[AWS architecture report](../../docs/aws-report.md). This README is the package-level reference.

## What it provisions

| Construct | Resources |
| --- | --- |
| `Network` (`lib/network.ts`) | One VPC (`10.0.0.0/16`), 2 AZs, public and private subnets, and **one `t4g.nano` NAT instance** (IMDSv2, no SSH key, VPC-only ingress, standard CPU credits). `natMode=gateway` uses a managed NAT gateway instead |
| `Frontend` (`lib/frontend.ts`) | Private S3 bucket and a CloudFront distribution (Origin Access Control, HTTPS redirect, SPA error routing, `PriceClass_100`) |
| `Compute` (`lib/compute.ts`) | An empty ECS cluster left from the original Fargate plan. No services, no cost |
| `Database` (`lib/database.ts`) | RDS PostgreSQL 16, single-AZ `db.t4g.micro`, 20 GB gp3, private, encrypted, credentials generated into Secrets Manager |
| `Auth` (`lib/auth.ts`) | Cognito user pool and web client (email and password). With `signupMode=allowlist` or `invite`, a pre-sign-up Lambda trigger outside the VPC |
| `Api` (`lib/api.ts`) | `@clara/api` as a Lambda behind an HTTP API with stage throttling, plus a CDK `Trigger` that runs the SQL migrations on every deploy |
| `Realtime` (`lib/realtime.ts`) | WebSocket API (`prod` stage, throttled) with `$connect`, `$disconnect` and `$default` Lambdas; DynamoDB `Connections` table with `RoomIndex` and `UserIndex` GSIs; a free DynamoDB gateway endpoint |
| `McpServer` (`lib/mcp.ts`) | `@clara/mcp-server` as a Lambda on the same HTTP API at `ANY /mcp` |

Every application Lambda runs Node.js 22 in the private subnets on one shared security group,
bundled with esbuild, so no Docker is needed.

## Settings

All settings are CDK context values resolved in `lib/config.ts`, with defaults that keep a fresh
deployment cheap and open. Put overrides in `cdk.context.json` (gitignored) or pass `-c key=value`:

| Key | Default | |
| --- | --- | --- |
| `natMode` | `instance` | `instance` or `gateway` |
| `natInstanceType` | `t4g.nano` | |
| `dbInstanceType`, `dbAllocatedStorageGb`, `dbMultiAz` | `t4g.micro`, `20`, `false` | |
| `retainData` | `false` | Keep stateful resources on destroy; RDS deletion protection and 7-day backups |
| `signupMode`, `signupAllowlist`, `signupInviteCodes` | `open` | Sign-up restrictions |
| `apiThrottleRate`, `apiThrottleBurst` | `50`, `100` | HTTP API stage throttle |
| `wsThrottleRate`, `wsThrottleBurst` | `100`, `200` | WebSocket stage throttle |
| `wsMaxConnectionsPerUser`, `wsMaxConnectionsPerRoom` | `10`, `25` | Enforced by `$connect` |
| `extraOrigins` | none | Extra CORS and Cognito callback origins, such as a custom domain |

The account and region come from your AWS profile (`CDK_DEFAULT_ACCOUNT`, `CDK_DEFAULT_REGION`).
Nothing account-specific is committed.

## Usage

```bash
# from the repository root
npm install
npm run bootstrap -w @clara/infra     # once per account and region

npm run infra:synth                   # synthesize CloudFormation (no AWS credentials needed)
npm run infra:test                    # Jest assertions on the template
npm run diff -w @clara/infra          # compare with the deployed stack
npm run deploy -w @clara/infra
npm run destroy -w @clara/infra
```

## Cost

The fixed cost in `eu-north-1` is about **$22/month** with the default NAT instance (about $52
with `natMode=gateway`), most of it the database. The line-by-line breakdown and ways to cut it
are in [docs/self-hosting-aws.md](../../docs/self-hosting-aws.md#costs).

## Stack outputs

`FrontendUrl`, `FrontendBucketName`, `FrontendDistributionId`, `ApiUrl`, `McpUrl`, `WebSocketUrl`,
`UserPoolId`, `UserPoolClientId`, `DbEndpoint`, `DbPort`, `DbCredentialsSecretArn`, `VpcId`,
`AppSecurityGroupId`, `EcsClusterName` and `EcsClusterArn`.
[docs/self-hosting-aws.md](../../docs/self-hosting-aws.md#5-read-the-outputs) explains what each one
is for and shows how to build and publish the frontend from them.

## Design notes

- **Lambda, not Fargate.** The PRD allowed either. Lambda needs no container build and adds no fixed
  cost; the MCP server shares the HTTP API rather than running behind its own ALB. The constraints
  this brings (a stateless MCP transport, the 30-second integration limit, account concurrency) are
  in [report §2.1](../../docs/aws-report.md#21-lambda-vs-fargate-and-why-fargate-was-dropped).
- **`$connect` never posts to its own connection.** API Gateway hasn't finished registering a
  connection while `$connect` runs, so a self-post fails with `GoneException`, and the broadcast
  helper would then prune the row it just wrote. The client sends `presence.sync` once the socket is
  open instead. See `packages/api/src/ws/connect-lambda.ts`.
- **Per-element last-write-wins** for diagram elements, documented in
  `packages/api/src/ws/message-lambda.ts` and [docs/realtime.md](../../docs/realtime.md).
- **Throttling is set on the auto-created `$default` stage in place**, so existing deployments keep
  their stage and URL.
- **The shared security group keeps its original description** ("…(Fargate)"). Changing a security
  group's description replaces it, which would detach every Lambda and the RDS ingress rule mid-deploy.

## Not here yet

Google sign-in, a custom domain with ACM, a least-privilege database role for the MCP Lambda,
verified database TLS and log retention are on the [roadmap](../../docs/roadmap.md).
