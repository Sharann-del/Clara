import assert from 'node:assert/strict';

// One scenario, two drivers: local.ts (services + local Postgres) and e2e.ts
// (the deployed stack over HTTP with real Cognito users). Both exercise the same
// MCP tool calls and assert the same human-review semantics.

export type Persona = 'owner' | 'editor' | 'viewer' | 'outsider';

export interface Driver {
  /** Creates a workspace with owner/editor/viewer members, plus a token per persona. */
  setup(): Promise<{ workspaceId: string; tokens: Record<Persona, string> }>;
  /** Raw POST to the MCP endpoint. token=null sends no Authorization header. */
  post(token: string | null, body: unknown): Promise<{ status: number; json: any }>;
  /** Review actions as a persona; return the HTTP-ish status plus body so failures can be asserted. */
  accept(as: Persona, changeId: string, force?: boolean): Promise<{ status: number; body: any }>;
  reject(as: Persona, changeId: string): Promise<{ status: number; body: any }>;
  listPending(as: Persona, workspaceId: string): Promise<any[]>;
  /** Direct (non-MCP) reads, as the owner, to verify what is actually stored. */
  getDocument(id: string): Promise<any>;
  getDiagram(id: string): Promise<any>;
  /** Human edit through the normal write path, to create staleness. */
  editDocument(id: string, contentMd: string): Promise<void>;
  versionCount(kind: 'documents' | 'diagrams', id: string): Promise<number>;
  cleanup(): Promise<void>;
}

let rpcId = 1;

export async function runScenario(d: Driver, log: (s: string) => void = console.log) {
  const { workspaceId, tokens } = await d.setup();
  const step = (s: string) => log(`  ✓ ${s}`);

  const call = async (persona: Persona, name: string, args: Record<string, unknown> = {}) => {
    const { status, json } = await d.post(tokens[persona], {
      jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args },
    });
    assert.equal(status, 200, `${name} HTTP ${status}: ${JSON.stringify(json)}`);
    const result = json.result;
    const text = result.content?.[0]?.text as string;
    return { isError: !!result.isError, text, data: result.isError ? undefined : JSON.parse(text) };
  };

  try {
    // --- transport + auth -------------------------------------------------
    assert.equal((await d.post(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status, 401);
    assert.equal((await d.post('clara_pat_bogus', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status, 401);
    step('requests without a valid personal access token are rejected (401)');

    const list = await d.post(tokens.viewer, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const toolNames: string[] = list.json.result.tools.map((t: any) => t.name);
    for (const t of ['list_workspaces', 'list_documents', 'read_document', 'create_document', 'update_document',
      'list_diagrams', 'read_diagram', 'create_diagram', 'update_diagram', 'traverse_diagram_hierarchy', 'import_mermaid']) {
      assert.ok(toolNames.includes(t), `missing tool ${t}`);
    }
    step(`tools/list exposes ${toolNames.length} tools`);

    // --- roles on reads ---------------------------------------------------
    const ws = await call('viewer', 'list_workspaces');
    assert.ok(ws.data.some((w: any) => w.id === workspaceId && w.role === 'viewer'));
    assert.deepEqual((await call('outsider', 'list_workspaces')).data, []);
    assert.equal((await call('outsider', 'list_documents', { workspace_id: workspaceId })).isError, true);
    step('reads respect workspace membership (outsider sees nothing and is refused)');

    // --- roles on writes --------------------------------------------------
    const viewerWrite = await call('viewer', 'create_document', { workspace_id: workspaceId, title: 'nope' });
    assert.equal(viewerWrite.isError, true);
    assert.match(viewerWrite.text, /Editor role required/);
    assert.equal((await d.listPending('owner', workspaceId)).length, 0);
    step('a viewer cannot even propose a write');

    // --- document: propose -> nothing applied -> accept -------------------
    const created = await call('editor', 'create_document', {
      workspace_id: workspaceId, title: 'Payments design', content_md: '# Payments\n\nUses Stripe.\n', tags: ['payments'],
      summary: 'Initial draft',
    });
    assert.equal(created.data.status, 'pending_review');
    assert.equal((await call('owner', 'list_documents', { workspace_id: workspaceId })).data.length, 0);
    step('create_document stages a pending change; no document exists yet');

    const pending = await d.listPending('owner', workspaceId);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].operation, 'create');
    assert.equal(pending[0].summary, 'Initial draft');

    assert.equal((await d.accept('viewer', created.data.changeId)).status, 403);
    assert.equal((await d.accept('outsider', created.data.changeId)).status, 403);
    step('only workspace editors+ can review');

    const accepted = await d.accept('owner', created.data.changeId);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    const docId: string = accepted.body.resource_id;
    assert.equal(accepted.body.status, 'accepted');
    const doc = await call('viewer', 'read_document', { document_id: docId });
    assert.equal(doc.data.title, 'Payments design');
    assert.equal(doc.data.contentMd, '# Payments\n\nUses Stripe.\n');
    assert.equal((await d.accept('owner', created.data.changeId)).status, 409);
    step('accept creates the document (and cannot be accepted twice)');

    // --- document update: text edit, version snapshot ---------------------
    const upd = await call('editor', 'update_document', {
      document_id: docId, text_edits: [{ find: 'Stripe', replace: 'Adyen' }], summary: 'Switch PSP',
    });
    assert.equal(upd.data.status, 'pending_review');
    assert.equal((await call('owner', 'read_document', { document_id: docId })).data.contentMd, '# Payments\n\nUses Stripe.\n');
    const before = await d.versionCount('documents', docId);
    const [updPending] = await d.listPending('owner', workspaceId);
    assert.equal(updPending.stale, false);
    assert.equal(updPending.current.contentMd, '# Payments\n\nUses Stripe.\n');
    assert.equal(updPending.diff_payload.proposed.contentMd, '# Payments\n\nUses Adyen.\n');
    assert.equal((await d.accept('owner', upd.data.changeId)).status, 200);
    assert.equal((await call('owner', 'read_document', { document_id: docId })).data.contentMd, '# Payments\n\nUses Adyen.\n');
    assert.equal(await d.versionCount('documents', docId), before + 1);
    step('update_document diff shown against live content; accept applies it and snapshots a version');

    // --- stale proposals --------------------------------------------------
    const stale = await call('editor', 'update_document', { document_id: docId, content_md: '# Rewritten by AI\n' });
    await d.editDocument(docId, '# A human edited this meanwhile\n');
    const [stalePending] = await d.listPending('owner', workspaceId);
    assert.equal(stalePending.stale, true);
    const refused = await d.accept('owner', stale.data.changeId);
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /changed after this change was proposed/);
    assert.equal((await d.getDocument(docId)).content_md, '# A human edited this meanwhile\n');
    step('a stale proposal is refused (409) instead of clobbering the human edit');
    const forced = await d.accept('owner', stale.data.changeId, true);
    assert.equal(forced.status, 200);
    assert.equal((await d.getDocument(docId)).content_md, '# Rewritten by AI\n');
    step('force=true overwrites after explicit review');

    // --- reject -----------------------------------------------------------
    const toReject = await call('editor', 'update_document', { document_id: docId, title: 'Hijacked' });
    assert.equal((await d.reject('viewer', toReject.data.changeId)).status, 403);
    assert.equal((await d.reject('owner', toReject.data.changeId)).status, 200);
    assert.equal((await d.getDocument(docId)).title, 'Payments design');
    assert.equal((await d.accept('owner', toReject.data.changeId)).status, 409);
    const mine = await call('editor', 'list_my_proposals', { workspace_id: workspaceId });
    assert.ok(mine.data.some((c: any) => c.changeId === toReject.data.changeId && c.status === 'rejected'));
    step('reject discards the change; the proposer can see it was rejected');

    // --- diagrams: mermaid import (new), C4 child, traversal --------------
    const mm = 'flowchart TD\n  A[Web App] --> B[API Gateway]\n  B -->|SQL| C[Postgres]';
    const imp = await call('editor', 'import_mermaid', { workspace_id: workspaceId, name: 'System context', mermaid_source: mm });
    assert.equal(imp.data.parsed.nodes, 3);
    assert.equal(imp.data.parsed.edges, 2);
    const impAccepted = await d.accept('owner', imp.data.changeId);
    assert.equal(impAccepted.status, 200, JSON.stringify(impAccepted.body));
    const rootId: string = impAccepted.body.resource_id;
    const root = await call('viewer', 'read_diagram', { diagram_id: rootId });
    assert.equal(root.data.elements.filter((e: any) => e.type === 'rect').length, 3);
    assert.equal(root.data.elements.filter((e: any) => e.type === 'connector').length, 2);
    assert.equal(root.data.source.format, 'mermaid');
    step('import_mermaid -> accept builds a laid-out diagram with its Mermaid source');

    const child = await call('editor', 'create_diagram', {
      workspace_id: workspaceId, name: 'API Gateway internals', parent_diagram_id: rootId,
      elements: [{ type: 'rect', geometry: { x: 10, y: 10, width: 120, height: 50, text: 'Auth' }, style: {} }],
    });
    const childId: string = (await d.accept('owner', child.data.changeId)).body.resource_id;
    const gateway = root.data.elements.find((e: any) => e.geometry.text === 'API Gateway');
    const link = await call('editor', 'update_diagram', {
      diagram_id: rootId, update_elements: [{ id: gateway.id, linkedDiagramId: childId, geometry: { text: 'API Gateway (see detail)' } }],
    });
    // The pending diagram diff must be an element-level change, not a rewrite.
    const [linkPending] = await d.listPending('owner', workspaceId);
    assert.equal(linkPending.diff_payload.proposed.elements.length, 5);
    assert.equal((await d.accept('owner', link.data.changeId)).status, 200);
    const after = await d.getDiagram(rootId);
    const linked = after.elements.find((e: any) => e.id === gateway.id);
    assert.equal(linked.linked_diagram_id, childId);
    assert.equal(linked.geometry.text, 'API Gateway (see detail)');
    assert.equal(linked.geometry.width, gateway.geometry.width, 'geometry is merge-patched, not replaced');
    assert.ok((await d.versionCount('diagrams', rootId)) >= 1);
    step('update_diagram merge-patches one element and links a child; accept snapshots a version');

    const tree = await call('viewer', 'traverse_diagram_hierarchy', { diagram_id: rootId, direction: 'down' });
    assert.deepEqual(tree.data.descendants.map((n: any) => n.id), [childId]);
    const up = await call('viewer', 'traverse_diagram_hierarchy', { diagram_id: childId, direction: 'up' });
    assert.deepEqual(up.data.ancestors.map((n: any) => n.id), [rootId]);
    step('traverse_diagram_hierarchy walks parents and children');

    assert.equal((await call('viewer', 'update_diagram', { diagram_id: rootId, name: 'x' })).isError, true);
    const bad = await call('editor', 'update_diagram', { diagram_id: rootId, remove_element_ids: ['3f2b8a52-9f1f-4c37-a9a8-5d2f7b0d1c11'] });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /Unknown element id/);
    assert.equal((await call('editor', 'import_mermaid', { workspace_id: workspaceId, name: 'x', mermaid_source: 'sequenceDiagram\n A->>B: hi' })).isError, true);
    step('viewer writes, unknown element ids and unsupported Mermaid come back as tool errors');
  } finally {
    await d.cleanup();
  }
}
