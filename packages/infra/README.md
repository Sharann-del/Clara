# @clara/infra

AWS CDK (TypeScript) app that provisions Clara's cloud infrastructure, per
section 6 of the [PRD](../../docs/clara-prd-aws.md).

Milestone 1 (core website) is deployed: the `Api` construct runs `@clara/api`
as a Lambda behind an HTTP API Gateway, with a deploy-time trigger that applies
the SQL migrations to RDS.

## What it provisions

| Construct        | Resource                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `Network`        | One VPC (`10.0.0.0/16`), 2 AZs, public + private subnets, **1 NAT gateway** |
| `Frontend`       | Private S3 bucket + CloudFront distribution (OAC, SPA error routing)    |
| `Compute`        | ECS Fargate **cluster** (currently unused — reserved for the milestone-4 MCP server) |
| `Database`       | RDS PostgreSQL 16, single-AZ **db.t4g.micro**, 20 GB gp3, private, encrypted |
| `Auth`           | Cognito User Pool + web client (email/password)                       |
| `Api`            | `@clara/api` (Fastify) as a Lambda behind an HTTP API Gateway, in the private subnets on `AppSecurityGroup`; a deploy-time `Trigger` Lambda runs the SQL migrations against RDS on every `cdk deploy` |

All wired together in a single stack, `ClaraStack` (`lib/clara-stack.ts`).

### Why Lambda instead of Fargate for the API

The PRD allows either (section 6, "Fargate vs. Lambda" is called out as an open
question). Lambda was chosen here because building/pushing a Fargate container
image needs Docker, which wasn't available in the dev environment this was
built in — `aws-lambda-nodejs` bundles via esbuild with no container runtime
needed. Revisit if the API outgrows Lambda's constraints (15 min timeout, no
long-lived connections/websockets).

### Not here yet

- Fargate service for the MCP server (milestone 4) — the empty `Compute`
  cluster is reserved for it
- API Gateway WebSocket + DynamoDB for realtime (milestone 2)
- Google OAuth IdP on Cognito — needs real client secrets in Secrets Manager
- ACM cert + custom domain on CloudFront

## Cost knobs

Everything is tuned to stay cheap for a student project. The dials live in
[`lib/config.ts`](lib/config.ts):

- `natGateways: 1` — one shared NAT instead of one per AZ
- `dbInstanceType: t4g.micro`, `dbMultiAz: false` — RDS free-tier eligible
- `retainData: false` — `cdk destroy` tears everything down; no orphaned billable
  resources. **Flip to `true` before storing real data.**

Rough steady-state estimate (us-east-1, outside free tier):

| Item                        | ~ USD / month |
| --------------------------- | ------------- |
| NAT gateway (+ data)        | ~$33          |
| RDS db.t4g.micro + 20 GB    | ~$13 (or $0 on free tier) |
| CloudFront + S3             | < $1 at low traffic |
| ECS cluster (no tasks)      | $0            |
| Cognito                     | $0 (well under the 50k MAU free tier) |
| **Total**                   | **~$15–47/mo**, dominated by the NAT gateway |

The NAT gateway is the thing to kill first if cost bites — replace it with VPC
interface endpoints or a t4g.nano NAT instance.

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

Region defaults to `us-east-1` (override with `CDK_DEFAULT_REGION`). The account
comes from your active AWS credentials (`CDK_DEFAULT_ACCOUNT`).

## Stack outputs

After `deploy`, CloudFormation prints the values the other packages need:
`VpcId`, `AppSecurityGroupId`, `FrontendBucketName`, `FrontendDistributionId`,
`FrontendUrl`, `EcsClusterName`, `EcsClusterArn`, `DbEndpoint`, `DbPort`,
`DbCredentialsSecretArn`, `UserPoolId`, `UserPoolClientId`, `ApiUrl`.

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
