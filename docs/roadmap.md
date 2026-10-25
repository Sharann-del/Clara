# Roadmap

What we plan to work on after v0.1.0, roughly in priority order within each group. This isn't a
promise of dates. Items come from known gaps in the code, the
[AWS architecture report](aws-report.md) and the original product requirements
([clara-prd-aws.md](clara-prd-aws.md)). If you'd like to help with one, open an issue first so we
can agree on the approach.

## Security and hardening

- **Least-privilege database roles.** Today every Lambda connects as the RDS master user. A separate
  Postgres role for the MCP Lambda (read the content tables, insert into `pending_mcp_changes`)
  would make "AI never writes directly" a database guarantee, not just a code convention.
- **Verified database TLS.** Bundle the RDS certificate authority and connect with
  `rejectUnauthorized: true` instead of encrypted but unverified TLS.
- **Secret rotation** for the RDS credentials in Secrets Manager.
- **CloudWatch log retention** on every Lambda log group. They currently never expire.
- **Optional AWS WAF** on CloudFront and the HTTP API, with per-IP rate rules on top of the stage
  throttling added in v0.1.0.
- **Per-token rate limits** for personal access tokens.

## Product

- **Push accepted AI changes to open tabs.** An accepted proposal is saved over REST, and people who
  already have the diagram open only see it after a reload.
- **OAuth for the MCP server**, so claude.ai custom connectors can connect without a bearer token.
- **Google sign-in** through a Cognito identity provider, with the OAuth client secret in Secrets
  Manager.
- **Custom domains:** an ACM certificate and alternate domain name on CloudFront, wired through
  `extraOrigins`.
- **Email through Amazon SES** for Cognito, to lift the built-in sender's 50-emails-a-day limit.
- **Version history pruning.** Every save stores a full snapshot. Keep recent versions in full and
  thin out older ones, or store diffs.
- **A desktop app:** the one client from the original build order (website, MCP server, desktop, mobile) that hasn't been built yet.

## Scale

- **Lighter cursor traffic.** Batch cursor updates and skip broadcasting them in large rooms, so
  live cursors use far fewer Lambda invocations.
- **Smaller database pools per Lambda** (one or two connections), then RDS Proxy if concurrency is
  raised.
- **Faster bulk diagram saves** with multi-row inserts, plus an element cap on the REST path to match
  the MCP limit.
- **Same-shape merge.** If several people editing the same shape at once becomes common, move
  element state to a CRDT. Per-element last-write-wins is enough for small teams today.
- **Graviton (arm64) Lambdas** for cheaper compute.

## Operations

- **Continuous deployment:** publish the frontend to S3 and invalidate CloudFront from a workflow
  after a release, using GitHub OIDC rather than stored AWS keys.
- **Remove the unused ECS cluster** left from the original Fargate plan.
- **Automated iOS builds** in CI on a macOS runner.

## Not planned for now

The original requirements left these out of scope for the first version, and that still stands:

- generating diagrams from a prompt
- templates and reusable rule blocks
