# Changelog

All notable changes to Clara are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

### Fixed

- Postgres engine version pinned to major version 16 so the stack deploys in regions that lack a
  specific minor version, such as eu-north-1.
- The Mermaid importer accepts semicolon statement separators.
- Element rows are normalized so the canvas sees linked child diagrams.
- Shapes that exist only in a diagram state now render correctly.

[0.1.0]: https://github.com/Sharann-del/Clara/releases/tag/v0.1.0
