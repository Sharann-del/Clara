// End-to-end check of per-item sharing, public links, members and folders against a running
// REST API, with MCP calls going through the real MCP handler on the same database.
//
//   API_URL=http://localhost:3001 TOKEN_A=<Cognito ID token> TOKEN_B=<another user's> \
//   DATABASE_URL=postgres://clara@localhost:5433/clara npx tsx scripts/sharing-e2e.ts
//
// A and B must be two different, real Cognito users. Everything created is deleted at the end.
import assert from 'node:assert/strict';
import { getPool } from '../../api/src/db.js';
import { handler } from '../src/handler.js';

const API = process.env.API_URL ?? 'http://localhost:3001';
const A = process.env.TOKEN_A!;
const B = process.env.TOKEN_B!;
if (!A || !B) throw new Error('Set TOKEN_A and TOKEN_B');

let passed = 0;
async function call(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}
async function expect(label: string, status: number, p: Promise<{ status: number; json: any }>) {
  const r = await p;
  assert.equal(r.status, status, `${label}: expected ${status}, got ${r.status} ${JSON.stringify(r.json)}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
  return r.json;
}
async function mcp(pat: string, name: string, args: Record<string, unknown>) {
  const res = await handler({
    requestContext: { http: { method: 'POST' }, domainName: 'localhost' },
    rawPath: '/mcp',
    rawQueryString: '',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${pat}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    isBase64Encoded: false,
  } as never);
  const result = JSON.parse(res.body!).result;
  return { isError: !!result.isError, text: result.content[0].text as string };
}

const meA = await call(A, 'GET', '/me');
const meB = await call(B, 'GET', '/me');
const emailB = meB.json.email as string;
const created: { ws: string[]; tokens: string[] } = { ws: [], tokens: [] };

try {
  console.log('per-item sharing (REST)');
  const ws = await expect('A creates a workspace', 201, call(A, 'POST', '/workspaces', { name: 'sharing-e2e' }));
  created.ws.push(ws.id);
  const diagram = await expect(
    'A creates a diagram',
    201,
    call(A, 'POST', `/workspaces/${ws.id}/diagrams`, { name: 'Embedded' }),
  );
  const other = await expect(
    'A creates a second diagram',
    201,
    call(A, 'POST', `/workspaces/${ws.id}/diagrams`, { name: 'Not embedded' }),
  );
  const doc = await expect(
    'A creates a document that embeds the first diagram',
    201,
    call(A, 'POST', `/workspaces/${ws.id}/documents`, {
      title: 'Shared doc',
      contentMd: `# Hi\n\n\`\`\`clara-diagram\nid: ${diagram.id}\n\`\`\`\n`,
    }),
  );
  await expect('B cannot read it', 403, call(B, 'GET', `/documents/${doc.id}`));
  await expect('B cannot favorite it', 403, call(B, 'PUT', `/favorites/document/${doc.id}`));
  await expect(
    'A shares it with B as viewer',
    201,
    call(A, 'POST', `/documents/${doc.id}/permissions`, { email: emailB, role: 'viewer' }),
  );
  const asViewer = await expect('B can read it now', 200, call(B, 'GET', `/documents/${doc.id}`));
  assert.equal(asViewer.role, 'viewer');
  await expect('…but not edit it', 403, call(B, 'PATCH', `/documents/${doc.id}`, { title: 'B was here' }));
  await expect('…or its version history restore', 200, call(B, 'GET', `/documents/${doc.id}/versions`));
  await expect('B sees it under shared-with-me', 200, call(B, 'GET', '/shared-with-me'));
  await expect('B can favorite it now', 204, call(B, 'PUT', `/favorites/document/${doc.id}`));
  const favs = await expect('B lists favorites', 200, call(B, 'GET', '/favorites'));
  assert.equal(favs[0]?.id, doc.id);
  const found = await expect('B finds it with search', 200, call(B, 'GET', '/search?q=shared'));
  assert.ok(found.some((r: { id: string }) => r.id === doc.id));
  await expect('B still cannot list the workspace', 403, call(B, 'GET', `/workspaces/${ws.id}/documents`));
  await expect(
    'A upgrades B to editor',
    200,
    call(A, 'PATCH', `/documents/${doc.id}/permissions/${meB.json.sub}`, { role: 'editor' }),
  );
  await expect('B can edit now', 200, call(B, 'PATCH', `/documents/${doc.id}`, { title: 'Edited by B' }));
  await expect('…but not delete (not a workspace member)', 403, call(B, 'DELETE', `/documents/${doc.id}`));
  await expect('…or move it between folders', 403, call(B, 'PATCH', `/documents/${doc.id}`, { folderId: null }));
  const grants = await expect('A lists who has access', 200, call(A, 'GET', `/documents/${doc.id}/permissions`));
  assert.equal(grants[0].email, emailB);

  console.log('per-item sharing (MCP)');
  const pat = await expect(
    'B creates an MCP token',
    201,
    call(B, 'POST', '/tokens', { name: 'sharing-e2e', expiresInDays: 1 }),
  );
  created.tokens.push(pat.id);
  let r = await mcp(pat.token, 'read_document', { document_id: doc.id });
  assert.ok(!r.isError && JSON.parse(r.text).title === 'Edited by B', r.text);
  console.log('  ✓ MCP read_document works for a direct share');
  passed += 1;
  r = await mcp(pat.token, 'update_document', { document_id: doc.id, content_md: 'proposed by B' });
  assert.ok(!r.isError && JSON.parse(r.text).status === 'pending_review', r.text);
  console.log('  ✓ MCP update_document proposes for a direct editor');
  passed += 1;
  r = await mcp(pat.token, 'read_diagram', { diagram_id: other.id });
  assert.ok(r.isError && /access/.test(r.text), r.text);
  console.log('  ✓ MCP read_diagram is refused for an unshared diagram');
  passed += 1;

  console.log('public links');
  const link = await expect('A creates a public link', 201, call(A, 'POST', `/documents/${doc.id}/share-links`));
  const pub = await expect('anyone can open it, unauthenticated', 200, call(null, 'GET', `/public/${link.token}`));
  assert.equal(pub.document.title, 'Edited by B');
  await expect(
    'the embedded diagram is readable through the link',
    200,
    call(null, 'GET', `/public/${link.token}/diagrams/${diagram.id}`),
  );
  await expect(
    'a diagram the document does not embed is not',
    404,
    call(null, 'GET', `/public/${link.token}/diagrams/${other.id}`),
  );
  await expect(
    'A downgrades B to viewer',
    200,
    call(A, 'PATCH', `/documents/${doc.id}/permissions/${meB.json.sub}`, { role: 'viewer' }),
  );
  await expect('B (viewer) cannot revoke the link', 403, call(B, 'DELETE', `/share-links/${link.id}`));
  await expect('A revokes it', 204, call(A, 'DELETE', `/share-links/${link.id}`));
  await expect('the link stops working', 404, call(null, 'GET', `/public/${link.token}`));
  await expect('a garbage token is a 404', 404, call(null, 'GET', '/public/not-a-real-token-at-all'));
  await expect('A revokes B’s access', 204, call(A, 'DELETE', `/documents/${doc.id}/permissions/${meB.json.sub}`));
  await expect('B can no longer read it', 403, call(B, 'GET', `/documents/${doc.id}`));
  const favsAfter = await expect('…and it drops out of B’s favorites', 200, call(B, 'GET', '/favorites'));
  assert.equal(favsAfter.length, 0);

  console.log('members');
  await expect(
    'A invites B as viewer',
    201,
    call(A, 'POST', `/workspaces/${ws.id}/members`, { email: emailB, role: 'viewer' }),
  );
  await expect(
    'inviting again is a conflict',
    409,
    call(A, 'POST', `/workspaces/${ws.id}/members`, { email: emailB, role: 'editor' }),
  );
  await expect(
    'B (viewer) cannot change roles',
    403,
    call(B, 'PATCH', `/workspaces/${ws.id}/members/${meA.json.sub}`, { role: 'viewer' }),
  );
  await expect(
    'A makes B an admin',
    200,
    call(A, 'PATCH', `/workspaces/${ws.id}/members/${meB.json.sub}`, { role: 'admin' }),
  );
  await expect(
    'B (admin) cannot demote the owner',
    403,
    call(B, 'PATCH', `/workspaces/${ws.id}/members/${meA.json.sub}`, { role: 'viewer' }),
  );
  await expect(
    'B (admin) cannot remove the owner',
    403,
    call(B, 'DELETE', `/workspaces/${ws.id}/members/${meA.json.sub}`),
  );
  await expect('the last owner cannot leave', 400, call(A, 'DELETE', `/workspaces/${ws.id}/members/${meA.json.sub}`));
  await expect(
    'the last owner cannot demote themselves',
    400,
    call(A, 'PATCH', `/workspaces/${ws.id}/members/${meA.json.sub}`, { role: 'admin' }),
  );
  await expect('B leaves', 204, call(B, 'DELETE', `/workspaces/${ws.id}/members/${meB.json.sub}`));
  await expect('B is out', 403, call(B, 'GET', `/workspaces/${ws.id}`));

  console.log('folders');
  const f1 = await expect(
    'A creates a folder',
    201,
    call(A, 'POST', `/workspaces/${ws.id}/folders`, { name: 'Parent' }),
  );
  const f2 = await expect(
    '…and a subfolder',
    201,
    call(A, 'POST', `/workspaces/${ws.id}/folders`, { name: 'Child', parentFolderId: f1.id }),
  );
  await expect(
    'moving a folder into its own child is refused',
    400,
    call(A, 'PATCH', `/folders/${f1.id}`, { parentFolderId: f2.id }),
  );
  await expect('…into itself too', 400, call(A, 'PATCH', `/folders/${f1.id}`, { parentFolderId: f1.id }));
  await expect('renaming works', 200, call(A, 'PATCH', `/folders/${f2.id}`, { name: 'Renamed' }));
  await expect(
    'moving the document into the subfolder works',
    200,
    call(A, 'PATCH', `/documents/${doc.id}`, { folderId: f2.id }),
  );
  const ws2 = await expect(
    'A creates another workspace',
    201,
    call(A, 'POST', '/workspaces', { name: 'sharing-e2e-2' }),
  );
  created.ws.push(ws2.id);
  await expect(
    'moving into another workspace’s folder is refused',
    400,
    call(A, 'PATCH', `/diagrams/${diagram.id}`, {
      folderId: (await call(A, 'POST', `/workspaces/${ws2.id}/folders`, { name: 'X' })).json.id,
    }),
  );
  await expect('deleting the parent folder works', 204, call(A, 'DELETE', `/folders/${f1.id}`));
  const moved = await expect('…and the document moved to the root', 200, call(A, 'GET', `/documents/${doc.id}`));
  assert.equal(moved.folder_id, null);

  console.log('versions');
  const versions = await expect('version list', 200, call(A, 'GET', `/documents/${doc.id}/versions`));
  const v = await expect(
    'a single version snapshot for preview',
    200,
    call(A, 'GET', `/documents/${doc.id}/versions/${versions[0].id}`),
  );
  assert.equal(typeof v.snapshot.content_md, 'string');

  console.log(`\n${passed} checks passed`);
} finally {
  for (const id of created.ws) await call(A, 'DELETE', `/workspaces/${id}`);
  for (const id of created.tokens) await call(B, 'DELETE', `/tokens/${id}`);
  await (await getPool()).end();
}
