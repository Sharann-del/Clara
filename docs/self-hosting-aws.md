# Self-hosting on AWS

Clara deploys as one CloudFormation stack, `ClaraStack`, defined with the AWS CDK in
`packages/infra`. This guide takes a fresh AWS account to a working Clara: bootstrap, deploy,
read the outputs, publish the frontend, and keep the bill small.

The whole stack lives in one region. The reference deployment runs in `eu-north-1` (Stockholm),
and any region with RDS PostgreSQL 16, Cognito and API Gateway WebSocket APIs works.

## What you need

- An AWS account and the [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- Node.js 22 and npm 10
- An AWS CLI profile with permission to create everything in the stack. The simplest is an IAM user
  or Identity Center role with `AdministratorAccess`, used only for deploying.

## 1. Configure a profile

```bash
aws configure --profile clara-admin     # access key, secret, region (for example eu-north-1)
export AWS_PROFILE=clara-admin
aws sts get-caller-identity             # confirms the account you're about to deploy to
```

The CDK takes the account and region from this profile. Nothing account-specific is committed to
the repository.

## 2. Install and bootstrap

```bash
git clone https://github.com/Sharann-del/Clara.git
cd Clara
npm install
npm run bootstrap -w @clara/infra
```

Bootstrapping is once per account and region. It creates the `CDKToolkit` stack: an S3 bucket and
IAM roles the CDK uses to upload Lambda bundles.

## 3. Choose settings (optional)

The defaults deploy an open, inexpensive instance. To change anything, create
`packages/infra/cdk.context.json` (gitignored) or pass `-c key=value` to each `cdk` command. For
example, to accept only sign-ups that present an invite code:

```json
{
  "signupMode": "invite",
  "signupInviteCodes": "spring-cohort-7,design-review"
}
```

[configuration.md](configuration.md#cdk-context-infrastructure-settings) lists every setting: NAT
mode, sign-up restrictions, throttling, WebSocket limits, data retention and extra origins.

Set `"retainData": true` before you store anything you'd mind losing. It keeps RDS, Cognito,
DynamoDB and S3 on `cdk destroy`, and turns on RDS deletion protection and 7-day backups.

## 4. Deploy

```bash
npm run infra:test                         # CDK assertion tests, about 30 seconds
npm run diff -w @clara/infra               # what will be created
npm run deploy -w @clara/infra
```

The first deploy takes about 15–20 minutes, mostly creating the RDS instance. CDK bundles every
Lambda with esbuild, so Docker isn't needed. On every deploy a CDK Trigger runs the SQL migrations
against RDS before the API Lambdas are updated.

## 5. Read the outputs

When the deploy finishes, CloudFormation prints the outputs. To read them again later:

```bash
aws cloudformation describe-stacks --stack-name ClaraStack \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table
```

| Output | Used for |
| --- | --- |
| `FrontendUrl` | The site's address (for example `https://d1example2cdn3.cloudfront.net`) and `VITE_SITE_URL` |
| `FrontendBucketName` | Where the frontend build is uploaded |
| `FrontendDistributionId` | CloudFront cache invalidation after an upload |
| `ApiUrl` | `VITE_API_URL` |
| `McpUrl` | The MCP endpoint for Claude Code and other clients |
| `WebSocketUrl` | `VITE_WS_URL` |
| `UserPoolId`, `UserPoolClientId` | `VITE_USER_POOL_ID`, `VITE_USER_POOL_CLIENT_ID`, and the local API |
| `DbEndpoint`, `DbPort`, `DbCredentialsSecretArn` | Database access for operators (private subnets only) |
| `VpcId`, `AppSecurityGroupId` | Networking, if you add resources to the VPC |
| `EcsClusterName`, `EcsClusterArn` | An empty ECS cluster left from the original Fargate plan; nothing uses it |

## 6. Build and publish the frontend

The frontend inlines its configuration at build time, so build it after the stack exists. This
script writes `packages/frontend/.env` from the outputs:

```bash
out() {
  aws cloudformation describe-stacks --stack-name ClaraStack \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
cat > packages/frontend/.env <<EOF
VITE_API_URL=$(out ApiUrl)
VITE_WS_URL=$(out WebSocketUrl)
VITE_USER_POOL_ID=$(out UserPoolId)
VITE_USER_POOL_CLIENT_ID=$(out UserPoolClientId)
VITE_AWS_REGION=$(aws configure get region)
VITE_SITE_URL=$(out FrontendUrl)
VITE_SIGNUP_INVITE_REQUIRED=false
EOF
```

Set `VITE_SIGNUP_INVITE_REQUIRED=true` if you deployed with `signupMode=invite`. Then build,
upload and invalidate the CloudFront cache:

```bash
npm run frontend:build
aws s3 sync packages/frontend/dist/ "s3://$(out FrontendBucketName)/" --delete
aws cloudfront create-invalidation --distribution-id "$(out FrontendDistributionId)" --paths "/*"
```

Open `FrontendUrl`, create an account and confirm it with the emailed code. Repeat this step
whenever the frontend changes.

## 7. Connect the extras (optional)

- **Claude Code:** create a token under Settings → Access tokens, then follow
  [mcp-setup.md](mcp-setup.md) with the `McpUrl` output.
- **iOS app:** after step 6, run `ios/scripts/configure.sh` to write the app's endpoint config,
  then see [ios/README.md](../ios/README.md).
- **Releases:** to have tagged releases attach a frontend build for your deployment, add the same
  `VITE_*` values as repository Actions variables (Settings → Secrets and variables → Actions →
  Variables).

## Updating

```bash
git pull
npm install
npm run diff -w @clara/infra
npm run deploy -w @clara/infra
# then step 6 again if the frontend changed
```

Migrations run automatically. Read `CHANGELOG.md` first for any release that calls out a manual step.

## Costs

On-demand list prices for `eu-north-1` from the AWS Pricing API (2026-10-25), 730 hours a month,
before tax, free tier or credits. Other regions differ by a few percent.

### Fixed monthly cost (with nobody using it)

| Item | Price | ≈ USD / month |
| --- | --- | --- |
| NAT instance, `t4g.nano`, standard CPU credits | $0.0043/h | 3.14 |
| NAT instance root volume, 8 GB gp3 | $0.0836/GB-month | 0.67 |
| Public IPv4 address on the NAT instance | $0.005/h | 3.65 |
| RDS `db.t4g.micro`, single-AZ PostgreSQL | $0.016/h | 11.68 |
| RDS storage, 20 GB gp3 | $0.12/GB-month | 2.40 |
| Secrets Manager, 1 secret | $0.40/secret | 0.40 |
| VPC, subnets, internet gateway, DynamoDB gateway endpoint, IAM, empty ECS cluster | free | 0.00 |
| **Total** | | **≈ 22** |

With `natMode=gateway` the first three lines become a managed NAT gateway ($0.046/h, $33.58) plus
its Elastic IP ($3.65), for a total of about **$52**.

### Usage-based costs

| Service | Price | Notes |
| --- | --- | --- |
| HTTP API (REST and MCP) | $1.06 per million requests | Requests over the stage throttle get a 429 and never invoke a Lambda |
| Lambda | $0.20 per million requests + $0.0000166667 per GB-second | The free tier covers 1M requests and 400,000 GB-seconds a month |
| WebSocket API | about $1 per million messages + $0.25 per million connection-minutes | Live cursors dominate the message count |
| DynamoDB on demand | $0.1345 per million reads, $0.67 per million writes | Writes on connect and disconnect, reads per broadcast |
| NAT instance data | no per-GB processing fee | A NAT gateway would add $0.046/GB |
| CloudFront, S3, Cognito, CloudWatch Logs | small at this scale | The CloudFront free tier covers 1 TB and 10M requests a month |

A small team (a few million requests and messages a month) adds roughly $5–10 to the fixed cost.
[aws-report.md §4](aws-report.md#4-cost-breakdown) has scenarios and the reasoning behind each line.

### How to cut it further

| Change | Saves ≈ / month | Trade-off |
| --- | --- | --- |
| Keep the default `natMode=instance` | $30 against a NAT gateway | The instance is a single point of failure you patch by replacing it (redeploy) |
| `cdk destroy` when not in use (with `retainData: false`) | All of it | Data is deleted; snapshot RDS first if you need it |
| Stop the RDS instance when idle (`aws rds stop-db-instance`) | $11.68 while stopped | AWS restarts it automatically after 7 days |
| RDS free tier, if your account qualifies | up to $14 for 12 months | Time-limited |
| Lower `apiThrottleRate` / `wsThrottleRate` | Caps the worst case | Heavy legitimate use gets 429s |
| Set a budget alert | Nothing, but you hear early | See below |

Set an AWS Budget with an email alert before you share the URL. With the AWS CLI, using your own
account ID and email address:

```bash
aws budgets create-budget --account-id 123456789012 \
  --budget '{"BudgetName":"clara-monthly","BudgetLimit":{"Amount":"20","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}' \
  --notifications-with-subscribers '[{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":80,"ThresholdType":"PERCENTAGE"},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"ops@example.com"}]}]'
```

## Limits of a new account

- **Lambda concurrency.** New accounts often start with a concurrency limit of 10 shared by every
  function. Live cursors use it fastest. Check it with `aws lambda get-account-settings`, and
  request an increase in Service Quotas before inviting a crowd.
- **Cognito email.** Cognito's built-in email sender is capped at 50 emails a day. For more, set up
  Amazon SES and configure the user pool to send through it.

## Tearing down

```bash
npm run destroy -w @clara/infra
```

With `retainData: false` this deletes everything, including the database and user accounts. With
`retainData: true`, RDS, the user pool, the DynamoDB table and the S3 bucket are kept and keep
billing. Delete them in the console when you're sure. The `CDKToolkit` stack stays until you delete
it.
