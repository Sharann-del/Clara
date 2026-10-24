import type { CodeFormat } from './share';

export interface Example {
  id: string;
  title: string;
  blurb: string;
  format: CodeFormat;
  code: string;
}

/** Playground gallery. Every example must parse to at least one node (checked in examples.test.ts). */
export const EXAMPLES: Example[] = [
  {
    id: 'web-app',
    title: 'Three-tier web app',
    blurb: 'Browser, CDN, API and database',
    format: 'clara',
    code: `# A classic three-tier app. Edit me — the diagram follows.
direction LR
node browser "Browser"
node cdn "CDN"
node api "API service"
node db "Postgres"
node cache "Redis cache"
edge browser -> cdn "static assets"
edge browser -> api "REST"
edge api -> cache "read-through"
edge api -> db "SQL"
group data "Data tier" { db cache }`,
  },
  {
    id: 'clara-aws',
    title: 'Clara on AWS',
    blurb: 'How this site is deployed',
    format: 'mermaid',
    code: `flowchart LR
  Browser[Browser - React SPA] --> CloudFront[CloudFront]
  CloudFront -->|OAC| S3[S3 site bucket]
  Browser -->|sign in| Cognito[Cognito User Pool]
  Browser -->|REST + ID token| HttpApi[API Gateway HTTP API]
  Browser -->|WSS| WsApi[API Gateway WebSocket]
  Claude[Claude via MCP] -->|POST /mcp + token| HttpApi
  HttpApi --> ApiFn[Lambda - REST API]
  HttpApi -->|/mcp| McpFn[Lambda - MCP server]
  WsApi --> WsFn[Lambda - realtime]
  ApiFn --> RDS[RDS PostgreSQL]
  McpFn --> RDS
  WsFn --> RDS
  WsFn --> DynamoDB[DynamoDB connections]`,
  },
  {
    id: 'event-driven',
    title: 'Event-driven orders',
    blurb: 'Queue fan-out to workers',
    format: 'clara',
    code: `node checkout "Checkout API"
node bus "Order events"
node pay "Payments worker"
node stock "Inventory worker"
node mail "Email worker"
node ledger "Ledger DB"
edge checkout -> bus "OrderPlaced"
edge bus -> pay
edge bus -> stock
edge bus -> mail
edge pay -> ledger "write"
group workers "Consumers" { pay stock mail }`,
  },
  {
    id: 'auth-flow',
    title: 'Login flow',
    blurb: 'OAuth-style sign in, top to bottom',
    format: 'mermaid',
    code: `flowchart TD
  User([User]) --> App[Web app]
  App -->|redirect| IdP[Identity provider]
  IdP -->|code| App
  App -->|code + secret| Token[Token endpoint]
  Token -->|ID + access token| App
  App -->|Bearer token| API[Resource API]`,
  },
  {
    id: 'c4-context',
    title: 'C4 system context',
    blurb: 'Level 1: people and systems',
    format: 'clara',
    code: `# C4 level 1. In a workspace, link each box to its level-2 diagram.
node customer "Customer"
node support "Support agent"
node shop "Online shop"
node erp "ERP system"
node email "Email provider"
edge customer -> shop "browses, orders"
edge support -> shop "manages orders"
edge shop -> erp "syncs stock"
edge shop -> email "sends receipts"`,
  },
  {
    id: 'ci-pipeline',
    title: 'CI/CD pipeline',
    blurb: 'Commit to production',
    format: 'clara',
    code: `direction LR
node push "git push"
node ci "Build + test"
node img "Container image"
node stage "Staging"
node prod "Production"
edge push -> ci
edge ci -> img "on green"
edge img -> stage "deploy"
edge stage -> prod "manual approve"`,
  },
];

export const DEFAULT_EXAMPLE = EXAMPLES[0];
