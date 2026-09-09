# @clara/infra

AWS CDK (TypeScript) app that provisions Clara's cloud infrastructure, per
section 6 of the [PRD](../../docs/clara-prd-aws.md).

Right now this is an **empty skeleton** — it stands up the AWS resources with no
application logic, so there's a real target to deploy to from day one and any
AWS permission / networking problems surface early.

## What it provisions

| Construct        | Resource                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `Network`        | One VPC (`10.0.0.0/16`), 2 AZs, public + private subnets, **1 NAT gateway** |
| `Frontend`       | Private S3 bucket + CloudFront distribution (OAC, SPA error routing)    |
| `Compute`        | ECS Fargate **cluster** (no services yet)                              |
| `Database`       | RDS PostgreSQL 16, single-AZ **db.t4g.micro**, 20 GB gp3, private, encrypted |
| `Auth`           | Cognito User Pool + web client (email/password)                       |

All wired together in a single stack, `ClaraStack` (`lib/clara-stack.ts`).

### Not here yet

- ALB + Fargate **services** for the API and MCP server (milestones 1 & 4)
- API Gateway WebSocket + DynamoDB for realtime (milestone 2)
- Google OAuth IdP on Cognito — needs real client secrets in Secrets Manager
- DB schema / migrations — those live with `@clara/api`
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
`DbCredentialsSecretArn`, `UserPoolId`, `UserPoolClientId`.
