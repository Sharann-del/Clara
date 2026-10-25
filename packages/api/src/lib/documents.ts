import type pg from 'pg';
import { query, withTransaction } from '../db.js';
import { assertFolderInWorkspace, assertResourceRole, assertWorkspaceRole, NotFoundError, type Role } from './authz.js';
import { recordVersion } from './versions.js';

// The one data path for documents: REST routes, MCP reads, and accepted MCP
// changes all go through these functions, so role checks and version snapshots
// can't drift between human and AI edits.

export interface DocumentCreateInput {
  title?: string;
  folderId?: string | null;
  contentMd?: string;
  tags?: string[];
}

export interface DocumentPatch {
  title?: string;
  contentMd?: string;
  tags?: string[];
  /** Present (even if null) = move to that folder / to the root; absent = leave alone. */
  folderId?: string | null;
}

export async function listDocuments(userId: string, workspaceId: string, folderId?: string) {
  await assertWorkspaceRole(userId, workspaceId, 'viewer');
  const cols = 'id, workspace_id, folder_id, title, tags, created_at, updated_at';
  const { rows } = folderId
    ? await query(`select ${cols} from documents where workspace_id = $1 and folder_id = $2 order by title`, [
        workspaceId,
        folderId,
      ])
    : await query(`select ${cols} from documents where workspace_id = $1 order by title`, [workspaceId]);
  return rows;
}

/** Loads a document and the caller's effective role on it (workspace role or a direct share). */
export async function loadDocument(userId: string, id: string, min: Role = 'viewer') {
  const { rows } = await query<Record<string, any> & { id: string; workspace_id: string }>(
    'select * from documents where id = $1',
    [id],
  );
  const doc = rows[0];
  if (!doc) throw new NotFoundError('Not found');
  const role = await assertResourceRole(userId, 'document', doc, min);
  return { doc, role };
}

/** Loads a document, checking the caller's effective role on it. */
export async function getDocument(userId: string, id: string, min: 'viewer' | 'editor' = 'viewer') {
  return (await loadDocument(userId, id, min)).doc;
}

export async function createDocument(
  userId: string,
  workspaceId: string,
  input: DocumentCreateInput,
  client?: pg.PoolClient,
) {
  await assertWorkspaceRole(userId, workspaceId, 'editor');
  await assertFolderInWorkspace(input.folderId, workspaceId);
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `insert into documents (workspace_id, folder_id, title, content_md, tags, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $6) returning *`,
    [workspaceId, input.folderId ?? null, input.title ?? 'Untitled', input.contentMd ?? '', input.tags ?? [], userId],
  );
  return rows[0];
}

/**
 * Applies a patch, snapshotting the pre-update state into `versions` in the same
 * transaction. Realtime note (milestone 2): this is the sole persistence path for
 * content_md — concurrent saves are whole-field last-write-wins.
 */
export async function updateDocument(userId: string, id: string, patch: DocumentPatch, client?: pg.PoolClient) {
  const doc = await getDocument(userId, id, 'editor');
  if ('folderId' in patch) {
    // Moving between folders is organizing the workspace, so it needs a workspace role, not just a share.
    await assertWorkspaceRole(userId, doc.workspace_id, 'editor');
    await assertFolderInWorkspace(patch.folderId, doc.workspace_id);
  }
  const apply = async (c: pg.PoolClient) => {
    await recordVersion('document', id, doc, doc.updated_by, c);
    const { rows } = await c.query(
      `update documents set
         title = coalesce($1, title),
         content_md = coalesce($2, content_md),
         tags = coalesce($3, tags),
         folder_id = case when $4::boolean then $5::uuid else folder_id end,
         updated_by = $6
       where id = $7 returning *`,
      [
        patch.title ?? null,
        patch.contentMd ?? null,
        patch.tags ?? null,
        'folderId' in patch,
        patch.folderId ?? null,
        userId,
        id,
      ],
    );
    return rows[0];
  };
  return client ? apply(client) : withTransaction(apply);
}
