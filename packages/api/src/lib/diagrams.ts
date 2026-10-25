import type pg from 'pg';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import {
  assertFolderInWorkspace,
  assertResourceRole,
  assertWorkspaceRole,
  BadRequestError,
  NotFoundError,
  type Role,
} from './authz.js';
import { recordVersion } from './versions.js';
import { listStates } from './states.js';
import { normalizeElement } from '@clara/shared/elements';

// The one data path for diagrams — see lib/documents.ts.

export const elementSchema = z.object({
  id: z.string().uuid().optional(),
  type: z.enum(['rect', 'ellipse', 'text', 'connector', 'group']),
  geometry: z.record(z.string(), z.unknown()).default({}),
  style: z.record(z.string(), z.unknown()).default({}),
  zIndex: z.number().int().default(0),
  linkedDiagramId: z.string().uuid().nullish(),
  parentGroupId: z.string().uuid().nullish(),
});

export interface DiagramCreateInput {
  name?: string;
  folderId?: string | null;
  parentDiagramId?: string | null;
  tags?: string[];
}

export interface DiagramPatch {
  name?: string;
  tags?: string[];
  folderId?: string | null;
  parentDiagramId?: string | null;
}

/** diagram_elements row (snake_case) -> the camelCase shape the API accepts and the diff code compares. */
export const toApiElement = normalizeElement;

export async function listDiagrams(userId: string, workspaceId: string, folderId?: string) {
  await assertWorkspaceRole(userId, workspaceId, 'viewer');
  const { rows } = folderId
    ? await query('select * from diagrams where workspace_id = $1 and folder_id = $2 order by name', [
        workspaceId,
        folderId,
      ])
    : await query('select * from diagrams where workspace_id = $1 order by name', [workspaceId]);
  return rows;
}

/** Loads a diagram row and the caller's effective role on it (workspace role or a direct share). */
export async function loadDiagram(userId: string, id: string, min: Role = 'viewer') {
  const { rows } = await query<Record<string, any> & { id: string; workspace_id: string }>(
    'select * from diagrams where id = $1',
    [id],
  );
  const diagram = rows[0];
  if (!diagram) throw new NotFoundError('Not found');
  const role = await assertResourceRole(userId, 'diagram', diagram, min);
  return { diagram, role };
}

/** Loads a diagram row, checking the caller's effective role on it. */
export async function getDiagramRow(userId: string, id: string, min: 'viewer' | 'editor' = 'viewer') {
  return (await loadDiagram(userId, id, min)).diagram;
}

export async function getDiagram(
  userId: string,
  id: string,
): Promise<Record<string, any> & { elements: Record<string, any>[]; role: Role }> {
  const { diagram, role } = await loadDiagram(userId, id, 'viewer');
  const elements = await query('select * from diagram_elements where diagram_id = $1 order by z_index', [id]);
  return { ...diagram, elements: elements.rows, role };
}

export async function getDiagramChildren(userId: string, id: string) {
  await getDiagramRow(userId, id, 'viewer');
  const { rows } = await query('select id, name from diagrams where parent_diagram_id = $1 order by name', [id]);
  return rows;
}

export async function createDiagram(
  userId: string,
  workspaceId: string,
  input: DiagramCreateInput,
  client?: pg.PoolClient,
) {
  await assertWorkspaceRole(userId, workspaceId, 'editor');
  await assertFolderInWorkspace(input.folderId, workspaceId);
  if (input.parentDiagramId) await assertParentDiagram(input.parentDiagramId, workspaceId);
  const apply = async (c: pg.PoolClient) => {
    const { rows } = await c.query(
      `insert into diagrams (workspace_id, folder_id, parent_diagram_id, name, tags, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $6) returning *`,
      [
        workspaceId,
        input.folderId ?? null,
        input.parentDiagramId ?? null,
        input.name ?? 'Untitled diagram',
        input.tags ?? [],
        userId,
      ],
    );
    await c.query('insert into diagram_source (diagram_id, dsl_text, format) values ($1, $2, $3)', [
      rows[0].id,
      '',
      'clara',
    ]);
    return rows[0];
  };
  return client ? apply(client) : withTransaction(apply);
}

/** C4 parent must be another diagram in the same workspace. */
async function assertParentDiagram(parentId: string, workspaceId: string, selfId?: string) {
  if (parentId === selfId) throw new BadRequestError('A diagram cannot be its own parent');
  const { rows } = await query<{ workspace_id: string }>('select workspace_id from diagrams where id = $1', [parentId]);
  if (!rows[0] || rows[0].workspace_id !== workspaceId)
    throw new BadRequestError('Parent diagram not found in this workspace');
}

export async function updateDiagramMeta(userId: string, id: string, patch: DiagramPatch, client?: pg.PoolClient) {
  const current = await getDiagramRow(userId, id, 'editor');
  if ('folderId' in patch) {
    await assertWorkspaceRole(userId, current.workspace_id, 'editor');
    await assertFolderInWorkspace(patch.folderId, current.workspace_id);
  }
  if (patch.parentDiagramId) await assertParentDiagram(patch.parentDiagramId, current.workspace_id, id);
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `update diagrams set
       name = coalesce($1, name),
       tags = coalesce($2, tags),
       folder_id = case when $3::boolean then $4::uuid else folder_id end,
       parent_diagram_id = case when $5::boolean then $6::uuid else parent_diagram_id end,
       updated_by = $7
     where id = $8 returning *`,
    [
      patch.name ?? null,
      patch.tags ?? null,
      'folderId' in patch,
      patch.folderId ?? null,
      'parentDiagramId' in patch,
      patch.parentDiagramId ?? null,
      userId,
      id,
    ],
  );
  return rows[0];
}

/** Snapshots a diagram's full current state (row + elements + states) into `versions`. */
export async function snapshotDiagram(diagramId: string, createdBy: string, client: pg.PoolClient) {
  const { rows: diagrams } = await client.query('select * from diagrams where id = $1', [diagramId]);
  const prior = await client.query('select * from diagram_elements where diagram_id = $1', [diagramId]);
  await recordVersion(
    'diagram',
    diagramId,
    { diagram: diagrams[0], elements: prior.rows, states: await listStates(diagramId, client) },
    createdBy,
    client,
  );
}

/** Delete-and-insert of a diagram's whole element list inside an open transaction. */
export async function writeElements(
  c: pg.PoolClient,
  diagramId: string,
  elements: z.infer<typeof elementSchema>[],
  userId: string,
) {
  await c.query('delete from diagram_elements where diagram_id = $1', [diagramId]);

  const inserted = [];
  for (const el of elements) {
    const { rows } = await c.query(
      `insert into diagram_elements
         (id, diagram_id, type, geometry, style, z_index, linked_diagram_id, parent_group_id)
       values (coalesce($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      [
        el.id ?? null,
        diagramId,
        el.type,
        JSON.stringify(el.geometry),
        JSON.stringify(el.style),
        el.zIndex,
        el.linkedDiagramId ?? null,
        el.parentGroupId ?? null,
      ],
    );
    inserted.push(rows[0]);
  }
  await c.query('update diagrams set updated_by = $1 where id = $2', [userId, diagramId]);
  return inserted;
}

/**
 * Bulk replace — the canvas saves its whole element list at once. Snapshots the
 * pre-replace state into `versions` in the same transaction.
 */
export async function replaceElements(
  userId: string,
  id: string,
  elements: z.infer<typeof elementSchema>[],
  client?: pg.PoolClient,
) {
  const diagram = await getDiagramRow(userId, id, 'editor');
  const apply = async (c: pg.PoolClient) => {
    const prior = await c.query('select * from diagram_elements where diagram_id = $1', [id]);
    await recordVersion(
      'diagram',
      id,
      { diagram, elements: prior.rows, states: await listStates(id, c) },
      diagram.updated_by,
      c,
    );
    return writeElements(c, id, elements, userId);
  };
  return client ? apply(client) : withTransaction(apply);
}

export async function getDiagramSource(userId: string, id: string) {
  await getDiagramRow(userId, id, 'viewer');
  const { rows } = await query('select * from diagram_source where diagram_id = $1', [id]);
  return rows[0] ?? { diagram_id: id, dsl_text: '', format: 'clara' };
}

export async function upsertSource(
  c: Pick<pg.PoolClient, 'query'>,
  diagramId: string,
  dslText: string,
  format: 'clara' | 'mermaid',
) {
  const { rows } = await c.query(
    `insert into diagram_source (diagram_id, dsl_text, format, updated_at) values ($1, $2, $3, now())
     on conflict (diagram_id) do update set dsl_text = excluded.dsl_text, format = excluded.format, updated_at = now()
     returning *`,
    [diagramId, dslText, format],
  );
  return rows[0];
}

export async function setDiagramSource(userId: string, id: string, dslText: string, format: 'clara' | 'mermaid') {
  await getDiagramRow(userId, id, 'editor');
  return upsertSource(
    { query: ((t: string, p?: unknown[]) => query(t, p ?? [])) as pg.PoolClient['query'] },
    id,
    dslText,
    format,
  );
}

export interface HierarchyNode {
  id: string;
  name: string;
  /** How this node relates to the starting diagram's level: parent_diagram_id, or a shape's linked_diagram_id. */
  via?: 'parent' | 'link';
  children?: HierarchyNode[];
}

/**
 * C4 traversal. Ancestors follow parent_diagram_id upward; descendants combine
 * `parent_diagram_id` children with diagrams reached through a shape's
 * `linked_diagram_id` (the drill-down link), de-duplicated and cycle-safe.
 * Only diagrams the caller can read (workspace viewer+) are returned.
 */
export async function traverseHierarchy(
  userId: string,
  id: string,
  direction: 'up' | 'down' | 'both',
  maxDepth: number,
) {
  const root = await getDiagramRow(userId, id, 'viewer');
  const workspaceId: string = root.workspace_id;

  const ancestors: { id: string; name: string }[] = [];
  if (direction !== 'down') {
    const seen = new Set([id]);
    let parentId: string | null = root.parent_diagram_id;
    while (parentId && !seen.has(parentId) && ancestors.length < maxDepth) {
      seen.add(parentId);
      const { rows } = await query(
        'select id, name, parent_diagram_id from diagrams where id = $1 and workspace_id = $2',
        [parentId, workspaceId],
      );
      if (!rows[0]) break;
      ancestors.unshift({ id: rows[0].id, name: rows[0].name });
      parentId = rows[0].parent_diagram_id;
    }
  }

  const expand = async (diagramId: string, depth: number, seen: Set<string>): Promise<HierarchyNode[]> => {
    if (depth >= maxDepth) return [];
    const { rows } = await query<{ id: string; name: string; via: 'parent' | 'link' }>(
      `select id, name, 'parent' as via from diagrams where parent_diagram_id = $1 and workspace_id = $2
       union
       select d.id, d.name, 'link' as via from diagram_elements e
         join diagrams d on d.id = e.linked_diagram_id
        where e.diagram_id = $1 and d.workspace_id = $2
       order by name`,
      [diagramId, workspaceId],
    );
    const nodes: HierarchyNode[] = [];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      nodes.push({ id: row.id, name: row.name, via: row.via, children: await expand(row.id, depth + 1, seen) });
    }
    return nodes;
  };

  const descendants = direction === 'up' ? [] : await expand(id, 0, new Set([id]));
  return { diagram: { id, name: root.name }, ancestors, descendants };
}
