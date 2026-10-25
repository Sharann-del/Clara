# Security Policy

## Supported versions

Clara is released from `main`. Security fixes go into the latest release and are not backported.

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| Older than 0.1.0 | No |

## Reporting a vulnerability

**Please don't report security vulnerabilities through public GitHub issues, discussions or pull
requests.**

Report them privately through GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/Sharann-del/Clara/security) of this repository.
2. Click **Report a vulnerability**.
3. Fill in the advisory form.

Only the maintainers can see the report. Please include as much of the following as you can:

- The kind of issue (for example authorization bypass, injection, cross-site scripting, token leak)
- The affected package, file paths or URLs
- The commit or release you tested against
- Step-by-step instructions to reproduce it, plus any proof-of-concept code
- The impact, and how an attacker could use it

## What to expect

- We acknowledge new reports within 3 business days.
- We send an initial assessment, including whether we accept the report, within 10 business days.
- We keep you updated while we work on a fix, and agree a disclosure date with you. We aim to
  ship a fix within 90 days of the report.
- With your permission, we credit you in the security advisory and the changelog.

## Scope

In scope:

- The code in this repository: `packages/api`, `packages/mcp-server`, `packages/frontend`,
  `packages/shared`, `packages/infra` and `ios/`
- The authorization model: workspace roles, per-item grants, public share links, personal access
  tokens, and the rule that MCP writes must be staged for human review
- Infrastructure defaults in the CDK stack that would leave a fresh deployment exposed

Out of scope:

- Vulnerabilities in AWS services themselves (report those to
  [AWS](https://aws.amazon.com/security/vulnerability-reporting/))
- Self-hosted deployments whose configuration differs from the defaults in this repository
- Denial of service through traffic volume, and findings from automated scanners with no
  demonstrated impact
- Social engineering of maintainers or users

## Hardening notes for self-hosters

Known limitations and recommended hardening steps (database TLS verification, a least-privilege
database role for the MCP Lambda, log retention, WAF) are listed in
[docs/aws-report.md §3](docs/aws-report.md#3-security). The abuse controls that ship with the stack
(sign-up restrictions, API throttling and WebSocket connection limits) are described in
[docs/configuration.md](docs/configuration.md).
