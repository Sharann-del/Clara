import type pg from 'pg';
import { query, withTransaction } from '../db.js';
import { assertWorkspaceRole, BadRequestError, ConflictError, NotFoundError } from './authz.js';
import { getDocument, createDocument, updateDocument, type DocumentCreateInput, type DocumentPatch } from './documents.js';
import {
  createDiagram,
  elementSchema,
  getDiagramRow,
  snapshotDiagram,
  toApiElement,
  updateDiagramMeta,
  upsertSource,
  writeElements,
  type DiagramCreateInput,
} from './diagrams.js';
import { diffElements } from '@clara/shared/diff';
import type { DiagramElement } from '@clara/shared/dsl';

// pending_mcp_changes (PRD 4.11): MCP writes never touch documents/diagrams
// directly. They are recorded here, and a human accepting one replays it through
// the same services the REST routes use, as the *reviewer* — so role checks and
// version snapshots are identical to a human edit.

const MAX_PENDING_PER_USER_PER_WORKSPACE = 50;
const MAX_CONTENT_CHARS = 500_000;
const MAX_ELEMENTS = 1000;

export type ResourceType = 'document' | 'diagram';

export interface DocumentFields {
  title: string;
  contentMd: string;
  tags: string[];
}

export interface DiagramFields {
  name: string;
  tags: string[];
  elements: DiagramElement[];
}

export interface DiagramProposed {
  name?: string;
  tags?: string[];
  folderId?: string | null;
  parentDiagramId?: string | null;
  /** Complete replacement element list (ids assigned at proposal time so the diff is stable). */
  elements?: DiagramElement[];
  source?: { dslText: string; format: 'clara' | 'mermaid' };
}

export interface Proposal {
  workspaceId: string;
  resourceType: ResourceType;
  resourceId: string | null;
  operation: 'create' | 'update';
  /** { proposed, base? } — see DocumentFields / DiagramProposed. */
  payload: { proposed: Record<string, unknown>; base?: Record<string, unknown> };
  summary: string;
  proposedBy: string;
  tokenId?: string | null;
}

export interface PendingChangeRow {
  id: string;
  workspace_id: string;
  resource_type: ResourceType;
  resource_id: string | null;
  operation: 'create' | 'update';
  diff_payload: Proposal['payload'];
  status: 'pending' | 'accepted' | 'rejected';
  proposed_by: string;
  token_id: string | null;
  summary: string;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

// ---------------------------------------------------------------- proposing

async function insertProposal(p: Proposal): Promise<PendingChangeRow> {
  const { rows: open } = await query<{ n: string }>(
    `select count(*) as n from pending_mcp_changes
      where workspace_id = $1 and proposed_by = $2 and status = 'pending'`,
    [p.workspaceId, p.proposedBy],
  );
  if (Number(open[0].n) >= MAX_PENDING_PER_USER_PER_WORKSPACE) {
    throw new BadRequestError(
      `${MAX_PENDING_PER_USER_PER_WORKSPACE} changes are already awaiting review in this workspace; ask a human to review them first`,
    );
  }
  const { rows } = await query<PendingChangeRow>(
    `insert into pending_mcp_changes
       (workspace_id, resource_type, resource_id, operation, diff_payload, proposed_by, token_id, summary)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
    [
      p.workspaceId,
      p.resourceType,
      p.resourceId,
      p.operation,
      JSON.stringify(p.payload),
      p.proposedBy,
      p.tokenId ?? null,
      p.summary,
    ],
  );
  return rows[0];
}

function checkSize(text: string | undefined) {
  if (text && text.length > MAX_CONTENT_CHARS) {
    throw new BadRequestError(`Content exceeds ${MAX_CONTENT_CHARS} characters`);
  }
}

export interface Actor {
  userId: string;
  tokenId?: string | null;
}

export async function proposeDocumentCreate(
  actor: Actor,
  workspaceId: string,
  input: DocumentCreateInput,
  summary = '',
) {
  await assertWorkspaceRole(actor.userId, workspaceId, 'editor');
  checkSize(input.contentMd);
  return insertProposal({
    workspaceId,
    resourceType: 'document',
    resourceId: null,
    operation: 'create',
    payload: { proposed: { title: input.title ?? 'Untitled', contentMd: input.contentMd ?? '', tags: input.tags ?? [], folderId: input.folderId ?? null } },
    summary,
    proposedBy: actor.userId,
    tokenId: actor.tokenId,
  });
}

const docFields = (d: Record<string, any>): DocumentFields => ({ title: d.title, contentMd: d.content_md, tags: d.tags });

export async function proposeDocumentUpdate(actor: Actor, id: string, patch: DocumentPatch, summary = '') {
  const doc = await getDocument(actor.userId, id, 'editor');
  checkSize(patch.contentMd);
  return insertProposal({
    workspaceId: doc.workspace_id,
    resourceType: 'document',
    resourceId: id,
    operation: 'update',
    payload: { proposed: { ...patch }, base: { ...docFields(doc) } },
    summary,
    proposedBy: actor.userId,
    tokenId: actor.tokenId,
  });
}

/** Gives every proposed element an id so accept and the diff agree on identity. */
export function normalizeElements(elements: unknown[]): DiagramElement[] {
  if (elements.length > MAX_ELEMENTS) throw new BadRequestError(`At most ${MAX_ELEMENTS} elements per diagram`);
  return elements.map((raw) => {
    const el = elementSchema.parse(raw);
    return { ...el, id: el.id ?? crypto.randomUUID() } as DiagramElement;
  });
}

/** Linked (drill-down) diagrams must exist in the same workspace, or accept would fail on the FK later. */
async function assertLinksResolve(workspaceId: string, elements: DiagramElement[]) {
  const ids = [...new Set(elements.map((e) => e.linkedDiagramId).filter((v): v is string => !!v))];
  if (ids.length === 0) return;
  const { rows } = await query('select id from diagrams where workspace_id = $1 and id = any($2::uuid[])', [workspaceId, ids]);
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.filter((i) => !found.has(i));
  if (missing.length) throw new BadRequestError(`linkedDiagramId not found in this workspace: ${missing.join(', ')}`);
}

export async function proposeDiagramCreate(
  actor: Actor,
  workspaceId: string,
  input: DiagramCreateInput & { elements?: unknown[]; source?: DiagramProposed['source'] },
  summary = '',
) {
  await assertWorkspaceRole(actor.userId, workspaceId, 'editor');
  const proposed: DiagramProposed = {
    name: input.name ?? 'Untitled diagram',
    tags: input.tags ?? [],
    folderId: input.folderId ?? null,
    parentDiagramId: input.parentDiagramId ?? null,
    elements: normalizeElements(input.elements ?? []),
    source: input.source,
  };
  await assertLinksResolve(workspaceId, proposed.elements ?? []);
  if (proposed.parentDiagramId) {
    const parent = await getDiagramRow(actor.userId, proposed.parentDiagramId, 'viewer');
    if (parent.workspace_id !== workspaceId) throw new BadRequestError('Parent diagram is in a different workspace');
  }
  return insertProposal({
    workspaceId,
    resourceType: 'diagram',
    resourceId: null,
    operation: 'create',
    payload: { proposed: proposed as Record<string, unknown> },
    summary,
    proposedBy: actor.userId,
    tokenId: actor.tokenId,
  });
}

export async function liveDiagramFields(id: string): Promise<DiagramFields | undefined> {
  const { rows } = await query('select name, tags from diagrams where id = $1', [id]);
  if (!rows[0]) return undefined;
  const els = await query('select * from diagram_elements where diagram_id = $1 order by z_index', [id]);
  return { name: rows[0].name, tags: rows[0].tags, elements: els.rows.map(toApiElement) };
}

export async function proposeDiagramUpdate(actor: Actor, id: string, proposed: DiagramProposed, summary = '') {
  const diagram = await getDiagramRow(actor.userId, id, 'editor');
  const base = (await liveDiagramFields(id))!;
  const normalized: DiagramProposed = { ...proposed };
  if (proposed.elements) {
    normalized.elements = normalizeElements(proposed.elements);
    await assertLinksResolve(diagram.workspace_id, normalized.elements);
  }
  if (proposed.parentDiagramId) {
    if (proposed.parentDiagramId === id) throw new BadRequestError('A diagram cannot be its own parent');
    const parent = await getDiagramRow(actor.userId, proposed.parentDiagramId, 'viewer');
    if (parent.workspace_id !== diagram.workspace_id) throw new BadRequestError('Parent diagram is in a different workspace');
  }
  return insertProposal({
    workspaceId: diagram.workspace_id,
    resourceType: 'diagram',
    resourceId: id,
    operation: 'update',
    payload: { proposed: normalized as Record<string, unknown>, base: base as unknown as Record<string, unknown> },
    summary,
    proposedBy: actor.userId,
    tokenId: actor.tokenId,
  });
}

// ---------------------------------------------------------------- reviewing

export interface PendingChangeView extends PendingChangeRow {
  /** Live resource fields right now (updates only, still-pending only). */
  current?: DocumentFields | DiagramFields | null;
  /** True when the resource has changed since the change was proposed. */
  stale: boolean;
  /** Resource display name for the panel header. */
  resource_name: string | null;
}

const sameDoc = (a: DocumentFields, b: DocumentFields) =>
  a.title === b.title && a.contentMd === b.contentMd && JSON.stringify(a.tags) === JSON.stringify(b.tags);

function isStale(row: PendingChangeRow, current: DocumentFields | DiagramFields | null | undefined): boolean {
  if (row.operation !== 'update') return false;
  if (!current) return true; // resource was deleted since
  const base = row.diff_payload.base as unknown;
  if (row.resource_type === 'document') return !sameDoc(base as DocumentFields, current as DocumentFields);
  const b = base as DiagramFields;
  const c = current as DiagramFields;
  const d = diffElements(b.elements, c.elements);
  return (
    b.name !== c.name ||
    JSON.stringify(b.tags) !== JSON.stringify(c.tags) ||
    d.added.length + d.removed.length + d.changed.length > 0
  );
}

async function viewOf(row: PendingChangeRow): Promise<PendingChangeView> {
  let current: DocumentFields | DiagramFields | null | undefined;
  let resourceName: string | null = null;
  if (row.operation === 'update' && row.resource_id) {
    if (row.resource_type === 'document') {
      const { rows } = await query('select * from documents where id = $1', [row.resource_id]);
      current = rows[0] ? docFields(rows[0]) : null;
      resourceName = rows[0]?.title ?? null;
    } else {
      current = (await liveDiagramFields(row.resource_id)) ?? null;
      resourceName = (current as DiagramFields | null)?.name ?? null;
    }
  } else {
    const p = row.diff_payload.proposed as { title?: string; name?: string };
    resourceName = p.title ?? p.name ?? null;
  }
  const pending = row.status === 'pending';
  return {
    ...row,
    current: pending ? current : undefined,
    stale: pending ? isStale(row, current) : false,
    resource_name: resourceName,
  };
}

export async function listPendingChanges(
  userId: string,
  workspaceId: string,
  status: PendingChangeRow['status'] = 'pending',
  limit = 100,
) {
  await assertWorkspaceRole(userId, workspaceId, 'editor');
  const { rows } = await query<PendingChangeRow>(
    `select * from pending_mcp_changes where workspace_id = $1 and status = $2
      order by created_at desc limit $3`,
    [workspaceId, status, limit],
  );
  return Promise.all(rows.map(viewOf));
}

export async function countPendingChanges(userId: string, workspaceId: string) {
  await assertWorkspaceRole(userId, workspaceId, 'editor');
  const { rows } = await query<{ n: string }>(
    "select count(*) as n from pending_mcp_changes where workspace_id = $1 and status = 'pending'",
    [workspaceId],
  );
  return Number(rows[0].n);
}

/** The proposer's own view of a change (any role that could have proposed it), for the MCP list tool. */
export async function listOwnProposals(userId: string, workspaceId: string, limit = 25) {
  await assertWorkspaceRole(userId, workspaceId, 'viewer');
  const { rows } = await query<PendingChangeRow>(
    `select * from pending_mcp_changes where workspace_id = $1 and proposed_by = $2
      order by created_at desc limit $3`,
    [workspaceId, userId, limit],
  );
  return rows;
}

async function loadForReview(userId: string, id: string, db: Pick<pg.PoolClient, 'query'>, lock: boolean) {
  const { rows } = await db.query<PendingChangeRow>(
    `select * from pending_mcp_changes where id = $1 ${lock ? 'for update' : ''}`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new NotFoundError('Change not found');
  await assertWorkspaceRole(userId, row.workspace_id, 'editor');
  if (row.status !== 'pending') throw new ConflictError(`Change was already ${row.status}`);
  return row;
}

export async function rejectChange(userId: string, id: string) {
  const row = await loadForReview(userId, id, { query } as Pick<pg.PoolClient, 'query'>, false);
  const { rows } = await query<PendingChangeRow>(
    `update pending_mcp_changes set status = 'rejected', reviewed_by = $2, reviewed_at = now()
      where id = $1 and status = 'pending' returning *`,
    [row.id, userId],
  );
  if (!rows[0]) throw new ConflictError('Change was already reviewed');
  return rows[0];
}

/**
 * Applies a pending change through the shared services as `userId` (the reviewer),
 * in one transaction with marking it accepted. Update paths snapshot the prior
 * state into `versions`, so every accepted AI edit is restorable from version
 * history. If the resource changed since the proposal (`stale`), it is refused
 * with a 409 unless `force` is set.
 */
export async function acceptChange(userId: string, id: string, opts: { force?: boolean } = {}) {
  return withTransaction(async (c) => {
    const row = await loadForReview(userId, id, c, true);
    const { proposed } = row.diff_payload;
    let resourceId = row.resource_id;

    if (row.operation === 'update' && !opts.force) {
      const view = await viewOf(row);
      if (view.stale) {
        throw new ConflictError(
          'The resource changed after this change was proposed. Review the diff against its current state and accept again with force=true to overwrite.',
        );
      }
    }

    if (row.resource_type === 'document') {
      if (row.operation === 'create') {
        const p = proposed as { title: string; contentMd: string; tags: string[]; folderId: string | null };
        resourceId = (await createDocument(userId, row.workspace_id, p, c)).id;
      } else {
        const patch = proposed as DocumentPatch;
        await updateDocument(userId, row.resource_id!, patch, c);
      }
    } else {
      const p = proposed as DiagramProposed;
      if (row.operation === 'create') {
        const created = await createDiagram(
          userId,
          row.workspace_id,
          { name: p.name, tags: p.tags, folderId: p.folderId, parentDiagramId: p.parentDiagramId },
          c,
        );
        resourceId = created.id;
        // Skips replaceElements/setDiagramSource: they authorize against rows read outside this
        // transaction, which can't see the diagram created inside it yet.
        if (p.elements?.length) await writeElements(c, created.id, p.elements.map((e) => elementSchema.parse(e)), userId);
        if (p.source) await upsertSource(c, created.id, p.source.dslText, p.source.format);
      } else {
        const diagramId = row.resource_id!;
        await getDiagramRow(userId, diagramId, 'editor');
        // One snapshot of the pre-change state, whether or not elements are replaced.
        await snapshotDiagram(diagramId, userId, c);
        const meta: Parameters<typeof updateDiagramMeta>[2] = { name: p.name, tags: p.tags };
        if ('folderId' in p) meta.folderId = p.folderId ?? null;
        if ('parentDiagramId' in p) meta.parentDiagramId = p.parentDiagramId ?? null;
        await updateDiagramMeta(userId, diagramId, meta, c);
        if (p.elements) await writeElements(c, diagramId, p.elements.map((e) => elementSchema.parse(e)), userId);
        if (p.source) await upsertSource(c, diagramId, p.source.dslText, p.source.format);
      }
    }

    const { rows } = await c.query<PendingChangeRow>(
      `update pending_mcp_changes set status = 'accepted', resource_id = $2, reviewed_by = $3, reviewed_at = now()
        where id = $1 returning *`,
      [row.id, resourceId, userId],
    );
    return rows[0];
  });
}
