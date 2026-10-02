// Runs the scenario against a *local* Postgres: MCP handler invoked with synthetic
// API Gateway events, review actions via the same services the REST routes call.
//   createdb clara_mcp_test && DATABASE_URL=postgres://localhost/clara_mcp_test npx tsx scripts/local.ts
import { randomUUID } from 'node:crypto';
import { query, getPool } from '../../api/src/db.js';
import { runMigrations } from '../../api/src/migrate.js';
import { createToken } from '../../api/src/lib/tokens.js';
import { acceptChange, listPendingChanges, rejectChange } from '../../api/src/lib/pending.js';
import { getDocument, updateDocument } from '../../api/src/lib/documents.js';
import { getDiagram } from '../../api/src/lib/diagrams.js';
import { handler } from '../src/handler.js';
import { runScenario, type Driver, type Persona } from './scenario.js';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to a local scratch database');
await runMigrations();

const ids: Record<Persona, string> = { owner: randomUUID(), editor: randomUUID(), viewer: randomUUID(), outsider: randomUUID() };
let workspaceId = '';

const status = (err: unknown) => (err as { statusCode?: number }).statusCode ?? 500;
const attempt = async (fn: () => Promise<unknown>) => {
  try {
    return { status: 200, body: await fn() };
  } catch (err) {
    return { status: status(err), body: { error: (err as Error).message } };
  }
};

const driver: Driver = {
  async setup() {
    workspaceId = (await query('insert into workspaces (name) values ($1) returning id', ['mcp-local-test'])).rows[0].id;
    for (const p of ['owner', 'editor', 'viewer'] as const) {
      await query('insert into workspace_members (workspace_id, user_id, role) values ($1,$2,$3)', [workspaceId, ids[p], p]);
    }
    const tokens = {} as Record<Persona, string>;
    for (const p of Object.keys(ids) as Persona[]) tokens[p] = (await createToken(ids[p], `test-${p}`, 1)).token;
    return { workspaceId, tokens };
  },
  async post(token, body) {
    const res = await handler({
      requestContext: { http: { method: 'POST' }, domainName: 'localhost' },
      rawPath: '/mcp', rawQueryString: '',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body), isBase64Encoded: false,
    } as never);
    return { status: res.statusCode ?? 500, json: res.body ? JSON.parse(res.body) : undefined };
  },
  accept: (as, id, force) => attempt(() => acceptChange(ids[as], id, { force })),
  reject: (as, id) => attempt(() => rejectChange(ids[as], id)),
  listPending: (as, ws) => listPendingChanges(ids[as], ws),
  getDocument: (id) => getDocument(ids.owner, id),
  getDiagram: (id) => getDiagram(ids.owner, id),
  editDocument: async (id, content) => void (await updateDocument(ids.owner, id, { contentMd: content })),
  async versionCount(kind, id) {
    const { rows } = await query('select count(*)::int as n from versions where resource_type = $1 and resource_id = $2', [kind === 'documents' ? 'document' : 'diagram', id]);
    return rows[0].n;
  },
  async cleanup() {
    await query('delete from workspaces where id = $1', [workspaceId]);
    await query('delete from personal_access_tokens where user_id = any($1)', [Object.values(ids)]);
  },
};

await runScenario(driver);
console.log('local scenario passed');
await (await getPool()).end();
