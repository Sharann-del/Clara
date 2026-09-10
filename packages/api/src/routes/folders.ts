import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { workspaceRole, roleAtLeast } from '../lib/authz.js';

export async function folderRoutes(app: FastifyInstance) {
  app.get('/workspaces/:workspaceId/folders', async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const role = await workspaceRole(req.user!.sub, workspaceId);
    if (!role) return reply.code(403).send({ error: 'Not a member of this workspace' });
    const { rows } = await query('select * from folders where workspace_id = $1 order by name', [
      workspaceId,
    ]);
    return rows;
  });

  app.post('/workspaces/:workspaceId/folders', async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const role = await workspaceRole(req.user!.sub, workspaceId);
    if (!roleAtLeast(role, 'editor')) return reply.code(403).send({ error: 'Editor role required' });

    const body = z
      .object({ name: z.string().min(1).max(200), parentFolderId: z.string().uuid().nullish() })
      .parse(req.body);

    const { rows } = await query(
      'insert into folders (workspace_id, parent_folder_id, name) values ($1, $2, $3) returning *',
      [workspaceId, body.parentFolderId ?? null, body.name],
    );
    reply.code(201).send(rows[0]);
  });

  app.patch('/folders/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await query('select workspace_id from folders where id = $1', [id]);
    if (!existing.rows[0]) return reply.code(404).send({ error: 'Not found' });
    const role = await workspaceRole(req.user!.sub, existing.rows[0].workspace_id);
    if (!roleAtLeast(role, 'editor')) return reply.code(403).send({ error: 'Editor role required' });

    const body = z
      .object({ name: z.string().min(1).max(200).optional(), parentFolderId: z.string().uuid().nullish() })
      .parse(req.body);

    const { rows } = await query(
      `update folders set
         name = coalesce($1, name),
         parent_folder_id = case when $2::boolean then $3::uuid else parent_folder_id end
       where id = $4 returning *`,
      [body.name ?? null, 'parentFolderId' in (req.body as object), body.parentFolderId ?? null, id],
    );
    return rows[0];
  });

  app.delete('/folders/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await query('select workspace_id from folders where id = $1', [id]);
    if (!existing.rows[0]) return reply.code(404).send({ error: 'Not found' });
    const role = await workspaceRole(req.user!.sub, existing.rows[0].workspace_id);
    if (!roleAtLeast(role, 'editor')) return reply.code(403).send({ error: 'Editor role required' });
    await query('delete from folders where id = $1', [id]);
    reply.code(204).send();
  });
}
