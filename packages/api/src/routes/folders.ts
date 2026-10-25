import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { assertWorkspaceRole, BadRequestError, NotFoundError } from '../lib/authz.js';

async function loadFolder(id: string) {
  const { rows } = await query<{ id: string; workspace_id: string; parent_folder_id: string | null }>(
    'select * from folders where id = $1',
    [id],
  );
  if (!rows[0]) throw new NotFoundError('Folder not found');
  return rows[0];
}

/** A folder's new parent must be in the same workspace and must not be the folder or one of its descendants. */
async function assertValidParent(workspaceId: string, parentId: string | null | undefined, folderId?: string) {
  if (!parentId) return;
  const parent = await loadFolder(parentId).catch(() => undefined);
  if (!parent || parent.workspace_id !== workspaceId)
    throw new BadRequestError('Parent folder not found in this workspace');
  if (!folderId) return;
  const { rows } = await query(
    `with recursive up as (
       select id, parent_folder_id from folders where id = $1
       union all
       select f.id, f.parent_folder_id from folders f join up on f.id = up.parent_folder_id
     ) select 1 from up where id = $2 limit 1`,
    [parentId, folderId],
  );
  if (rows.length) throw new BadRequestError('A folder can’t be moved into itself or one of its subfolders');
}

export async function folderRoutes(app: FastifyInstance) {
  app.get('/workspaces/:workspaceId/folders', async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    await assertWorkspaceRole(req.user!.sub, workspaceId, 'viewer');
    const { rows } = await query('select * from folders where workspace_id = $1 order by name', [workspaceId]);
    return rows;
  });

  app.post('/workspaces/:workspaceId/folders', async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    await assertWorkspaceRole(req.user!.sub, workspaceId, 'editor');
    const body = z
      .object({ name: z.string().trim().min(1).max(200), parentFolderId: z.string().uuid().nullish() })
      .parse(req.body);
    await assertValidParent(workspaceId, body.parentFolderId);
    const { rows } = await query(
      'insert into folders (workspace_id, parent_folder_id, name) values ($1, $2, $3) returning *',
      [workspaceId, body.parentFolderId ?? null, body.name],
    );
    reply.code(201).send(rows[0]);
  });

  app.patch('/folders/:id', async (req) => {
    const { id } = req.params as { id: string };
    const folder = await loadFolder(id);
    await assertWorkspaceRole(req.user!.sub, folder.workspace_id, 'editor');
    const body = z
      .object({ name: z.string().trim().min(1).max(200).optional(), parentFolderId: z.string().uuid().nullish() })
      .parse(req.body);
    const moving = req.body != null && typeof req.body === 'object' && 'parentFolderId' in req.body;
    if (moving) await assertValidParent(folder.workspace_id, body.parentFolderId, id);
    const { rows } = await query(
      `update folders set
         name = coalesce($1, name),
         parent_folder_id = case when $2::boolean then $3::uuid else parent_folder_id end
       where id = $4 returning *`,
      [body.name ?? null, moving, body.parentFolderId ?? null, id],
    );
    return rows[0];
  });

  /** Deletes the folder and its subfolders; documents and diagrams inside move to the workspace root. */
  app.delete('/folders/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const folder = await loadFolder(id);
    await assertWorkspaceRole(req.user!.sub, folder.workspace_id, 'editor');
    await query('delete from folders where id = $1', [id]);
    reply.code(204).send();
  });
}
