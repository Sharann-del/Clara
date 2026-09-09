# Clara — Product Requirements Document (AWS Edition)

## 1. Overview

Clara is a system design documentation tool combining a freeform diagram canvas, diagram-as-code, markdown documents, and an MCP server that lets AI assistants read and write diagrams and docs directly. Built from scratch for a cloud architecture and design course project, hosted entirely on AWS.

**Team**: Sharann, Dhriti

**Build order**: Website → MCP server → Desktop app → Mobile app (this PRD covers the website v1 + MCP)

**Explicitly out of scope for v1**: AI diagram generation (prompt-to-diagram), templates/reusable rule blocks.

---

## 2. Goals

- Let teams create and maintain system design documentation that combines markdown text and diagrams in one place.
- Support both freeform visual diagramming and text-based diagram authoring (diagram-as-code), kept in sync.
- Allow architecture diagrams to nest into deeper levels of detail (C4-style drill-down), with no fixed depth limit.
- Let diagrams double as interactive explainers — walking a viewer through how a system evolves or behaves across states.
- Expose the full document/diagram model to Claude via MCP, so AI-assisted edits are possible without bypassing human review.
- Demonstrate a real multi-service AWS architecture (compute, managed DB, auth, storage, realtime, CDN) as the course deliverable.

---

## 3. Users

- Individual users documenting personal or academic projects.
- Teams collaborating on shared architecture documentation in real time.

---

## 4. Core Features

### 4.1 Auth & Workspaces
- Sign in via email/password or OAuth (Google), via Amazon Cognito User Pools.
- Team workspaces; each user has a role at the workspace level.
- Per-document sharing/permissions: owner, editor, viewer.

### 4.2 Organization
- Nested folders (file-system style) within a workspace.
- Tags/labels on both documents and diagrams, independent of folder placement.

### 4.3 Markdown Documents
- Toggle between raw markdown source and a WYSIWYG rich view.
- Diagrams embed inline via a reference block that renders live.

### 4.4 Diagram Canvas
- SVG-based freeform canvas: shapes, arrows/connectors, text, groups.
- Drag, resize, pan, zoom, multi-select.

### 4.5 Diagram-as-Code
- Custom Clara DSL: text syntax that compiles into canvas elements via an auto-layout engine (Dagre).
- Import existing Mermaid syntax into Clara's format.
- Export any Clara diagram back out as Mermaid.

### 4.6 C4 Drill-Down
- Any diagram can link to a child diagram from any shape.
- Unlimited nesting depth — not restricted to the strict 3-level C4 model.
- Clicking a linked shape navigates into the child diagram.

### 4.7 Interactive Explainers
- Diagrams support named states (e.g. "current," "interim," "future").
- Each state stores per-element overrides (visibility, style, position).
- Viewers step through states manually (next/prev) or via timed auto-play.

### 4.8 Version History
- Full version history for both documents and diagrams, with restore to any prior version.

### 4.9 Export
- Diagrams: PNG, SVG, PDF.
- Documents: raw markdown file.

### 4.10 Real-Time Collaboration
- Multiple users edit the same document or diagram simultaneously.
- Live cursors, live element updates, presence indicators.
- Requires conflict resolution strategy (CRDT or OT) on the shared element list — flagged as a dedicated design task, not a simple feature.

### 4.11 MCP Server
- Tools: list/read/create/update documents; list/read/create/update diagrams; traverse C4 hierarchy; import Mermaid source.
- Writes do not apply directly — every MCP-originated change is staged as a pending diff that a human must accept or reject in the UI.

---

## 5. Data Model (Amazon RDS for PostgreSQL)

Same schema as before, now hosted on RDS instead of Supabase:

| Table | Key fields |
|---|---|
| `workspaces` | id, name |
| `workspace_members` | workspace_id, user_id, role |
| `folders` | id, workspace_id, parent_folder_id, name |
| `documents` | id, folder_id, title, content_md, tags[] |
| `diagrams` | id, folder_id, parent_diagram_id, name, tags[] |
| `diagram_elements` | id, diagram_id, type, geometry, style, z_index, linked_diagram_id |
| `diagram_source` | diagram_id, dsl_text |
| `diagram_states` | id, diagram_id, name, order_index, element_overrides |
| `permissions` | resource_id, resource_type, user_id, role |
| `versions` | id, resource_id, resource_type, snapshot, created_at, created_by |
| `pending_mcp_changes` | id, resource_id, diff_payload, status |

---

## 6. Technical Approach — AWS Native

Supabase is dropped in favor of a service-per-concern AWS architecture (better fit for a cloud architecture course, since it shows explicit use of individual managed services rather than one BaaS).

| Concern | Supabase (old) | AWS (new) |
|---|---|---|
| Frontend hosting | Supabase-adjacent static host | **S3 + CloudFront** |
| API compute | Supabase Edge Functions | **ECS Fargate** (API + MCP server) behind an **ALB**, or Lambda + API Gateway if you want serverless |
| Database | Supabase Postgres | **Amazon RDS for PostgreSQL** (or Aurora Serverless v2 if you want autoscaling to show off) |
| Auth | Supabase Auth | **Amazon Cognito** (User Pools + Identity Pools, Google as OAuth IdP) |
| Realtime (live cursors/edits) | Supabase Realtime | **API Gateway WebSocket API** + Lambda (connection table in DynamoDB), broadcasting diffs to connected clients |
| File storage (exports) | Supabase Storage | **S3** bucket, signed URLs for PNG/SVG/PDF downloads |
| MCP server | Node service | Same Node service, containerized, deployed as a second **ECS Fargate** service (or same service, different route) |
| Secrets | Supabase env | **AWS Secrets Manager** for DB creds, OAuth secrets |
| IaC | — | **Terraform** or **AWS CDK** (recommended: CDK in TypeScript, matches the app stack) |

**Frontend**: React, SVG rendering for the canvas (chosen over HTML5 Canvas for easier DOM-based real-time diffing, styling, and hit-testing). Built and deployed as a static bundle to S3, served via CloudFront.

**Backend**: Node/Express (or Fastify) API on ECS Fargate. Talks to RDS for persistence, Cognito for auth verification (JWT), S3 for exports, and the WebSocket API for realtime fan-out.

**Layout engine**: Dagre for auto-positioning nodes parsed from the Clara DSL / Mermaid.

**MCP server**: Node-based, operating on the same element/document schema the REST API uses, so AI and human edits share one data path. Runs as its own Fargate service so it can be scaled/secured independently of the main API.

**Networking**: One VPC, public subnets for ALB, private subnets for Fargate tasks and RDS. This is the part your course grader will actually look at — draw it as a Clara diagram once the app works, meta as that is.

---

## 7. Milestones

1. **Core website**: auth (Cognito), workspaces, folders/tags, canvas editor, markdown editor, DSL + Mermaid import/export, C4 linking, version history, export — running against RDS via the Fargate API, deployed to S3/CloudFront.
2. **Real-time collaboration** layer (API Gateway WebSocket + DynamoDB connection table).
3. **Interactive explainers** (states + playback).
4. **MCP server** with diff-based write review, deployed as its own Fargate service.
5. **AWS write-up**: architecture diagram (built in Clara itself), IaC (CDK/Terraform), cost estimate — this is the actual course deliverable alongside the app.
6. Desktop app (wraps the web app).
7. Mobile app.

---

## 8. Open Design Questions

- Conflict resolution strategy for real-time multiplayer editing (CRDT vs. OT).
- Exact grammar for the Clara DSL.
- UI for reviewing/accepting MCP-proposed diffs.
- Fargate vs. Lambda for the API — Fargate is simpler to reason about and demo live; Lambda is cheaper/more "cloud-native" for a course grade. Worth deciding before scaffolding.
- Aurora Serverless v2 vs. plain RDS — Serverless shows autoscaling in the architecture story but adds cold-start latency risk during a live demo.

---

## 9. Building This With Claude Code

Suggested approach, following the milestone order above:

1. **Scaffold the monorepo** first — a `packages/` layout (frontend, api, mcp-server, infra) so Claude Code can work on one package at a time without cross-contaminating context.
2. **Infra first, stubbed**: write the CDK/Terraform for VPC, RDS, Cognito, S3+CloudFront, ECS cluster before writing app logic, so you have somewhere real to deploy to from day one. Deploy an empty "hello world" API early to catch AWS permission/networking issues before they're buried under app code.
3. **Milestone 1** (core website) in its own long Claude Code session(s): auth wiring, schema + migrations, canvas, markdown editor, DSL parser, C4 linking, exports.
4. **Milestone 2** (realtime) as a separate focused session once milestone 1 is stable — WebSocket infra is easy to get wrong and easier to debug in isolation.
5. **Milestone 4** (MCP server) last, reusing the same DB access layer as the API so Claude (this MCP server, not Claude Code) can't drift from what the UI does.