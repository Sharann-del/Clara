# Changelog

All notable changes to Clara are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- The NAT instance now forwards traffic. CDK's default setup script found the outbound interface
  with `route`, which Amazon Linux 2023 doesn't include, and the private routes switched to the
  instance before it had finished booting, so deploys with the default `natMode=instance` failed
  with Lambda timeouts. Clara now configures the instance with its own script that verifies NAT
  works, and CloudFormation waits for the instance to signal success before switching the routes.

## [0.1.0] - 2026-10-25

The first public release: the web app, MCP server, AWS infrastructure and the native iOS app.

### Added

- **Infrastructure.** One AWS CDK stack, `ClaraStack`: VPC, private S3 bucket behind CloudFront,
  RDS PostgreSQL 16, Cognito user pool, an HTTP API with the REST Lambda, and a deploy-time
  Trigger that applies SQL migrations on every `cdk deploy`.
- **Workspaces and content.** Workspaces with viewer, editor, admin and owner roles, nested folders,
  tags, markdown documents and diagrams, version history with restore, and markdown export.
- **Diagram canvas.** Shapes, connectors, text and groups with drag, resize, pan, zoom and
  multi-select.
- **Diagrams as code.** The Clara DSL and Mermaid import with Dagre auto-layout, and Mermaid export.
- **C4 drill-down.** Any shape can link to a child diagram, with no depth limit.
- **Interactive explainers.** Named diagram states with per-element overrides, plus a present mode
  that starts at the base state.
- **Real-time collaboration.** An API Gateway WebSocket API with a DynamoDB connections table:
  presence, live cursors, live typing and live canvas edits, with per-element last-write-wins
  conflict resolution.
- **Member invites** by email, and a clear no-access state for items you can't open.
- **MCP server.** A stateless streamable-HTTP MCP server on `/mcp` with personal access tokens.
  Every AI write is staged as a pending change that a person accepts or rejects from a diff, with
  stale-change detection.
- **Access token page and Pending changes review** in the web app.
- **Public site.** Landing page with a live editor, a playground at `/editor` with URL-encoded
  share links, in-app docs, pricing, about, privacy and terms pages, a sitemap and Open Graph tags.
- **Sharing.** Per-item grants enforced in REST, WebSocket and MCP, revocable public read-only
  links at `/s/:token`, and a "shared with you" list.
- **App experience.** First-run onboarding, a product tour, favorites, title and tag search, a ⌘K
  command palette and keyboard shortcuts.
- **Export.** SVG, PNG, PDF and Mermaid from one shared renderer.
- **Dark design system** with Share, History, Members and Pending changes as full routed pages,
  and label wrapping inside diagram shapes.
- **Native iOS app** (SwiftUI) with feature parity, running `@clara/shared` in JavaScriptCore.
- **Tests.** Unit tests for the shared engine, frontend libraries, API and MCP edit operations; CDK
  assertion tests; MCP and sharing integration scripts; a Playwright smoke test.
- **Docs.** AWS architecture report, route reference and the product requirements document.
- **Cheaper egress.** A `t4g.micro` NAT instance (Amazon Linux 2023, IMDSv2, no SSH key, accepts
  traffic only from the VPC) replaces the managed NAT gateway, cutting the fixed monthly cost in
  `eu-north-1` from about $52 to about $25. `natMode=gateway` switches back, and
  `natInstanceType` picks another type.
- **Abuse and cost controls.** Stage throttling on the HTTP API (50 requests/s, burst 100) and the
  WebSocket API (100 messages/s, burst 200), limits of 10 open WebSocket connections per user and
  25 per document or diagram, and an optional Cognito pre-sign-up trigger that restricts sign-up
  to an allowlist of emails and domains or to invite codes (`signupMode`, off by default). The web
  and iOS sign-up forms show an invite-code field when one is required.
- **Config-driven deployment.** Every infrastructure setting is a CDK context value with defaults
  that suit a fresh account, and the account and region come from the AWS profile. iOS endpoints
  are generated from the web app's environment, and iOS signing lives in `xcconfig` files, so
  forks need no code changes.
- **Open-source project files.** MIT license, contributing guide, code of conduct, security
  policy, issue and pull request templates, and guides for getting started, self-hosting on AWS,
  configuration, architecture, the API, MCP setup, realtime, sharing and permissions, testing,
  troubleshooting and the roadmap.
- **Tooling.** ESLint, Prettier and EditorConfig; CI that runs lint, format, typecheck, unit and
  infrastructure tests, the frontend build, `cdk synth` and Playwright on every push and pull
  request; a release workflow for version tags; and Dependabot for npm and GitHub Actions.

### Changed

- The Playwright suite starts the dev server itself when `E2E_BASE_URL` isn't set, and the
  smoke-test account gets a fresh random password on every run.

### Fixed

- Postgres engine version pinned to major version 16 so the stack deploys in regions that lack a
  specific minor version, such as eu-north-1.
- The Mermaid importer accepts semicolon statement separators.
- Element rows are normalized so the canvas sees linked child diagrams.
- Shapes that exist only in a diagram state now render correctly.
- The iOS sign-up form asked for at least 8 password characters; the user pool requires 10.

### Security

- Example configuration files and the Git history no longer contain real AWS account, Cognito, API
  Gateway or CloudFront identifiers, or an Apple team ID.

[Unreleased]: https://github.com/Sharann-del/Clara/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Sharann-del/Clara/releases/tag/v0.1.0
