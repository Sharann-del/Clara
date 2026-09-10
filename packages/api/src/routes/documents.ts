import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { workspaceRole, roleAtLeast } from '../lib/authz.js';
import { recordVersion } from '../lib/versions.js';

async function requireDocRole(userId: string, docId: string, min: 'viewer' | 'editor') {
  const { rows } = await query('select * from documents where id = $1', [docId]);
  const doc = rows[0];
  if (!doc) return { doc: undefined, role: undefined };
  const role = await workspaceRole(userId, doc.workspace_id);
  return { doc, role, ok: roleAtLeast(role, min) };
}

export async function documentRoutes(app: FastifyInstance) {
  app.get('/workspaces/:workspaceId/documents', async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const { folderId } = req.query as { folderId?: string };
    const role = await workspaceRole(req.user!.sub, workspaceId);
    if (!role) return reply.code(403).send({ error: 'Not a member of this workspace' });

    const { rows } = folderId
      ? await query(
          'select id, workspace_id, folder_id, title, tags, created_at, updated_at from documents where workspace_id = $1 and folder_id = $2 order by title',
          [workspaceId, folderId],
        )
      : await query(
          'select id, workspace_id, folder_id, title, tags, created_at, updated_at from documents where workspace_id = $1 order by title',
          [workspaceId],
        );
    return rows;
  });

  app.post('/workspaces/:workspaceId/documents', async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const role = await workspaceRole(req.user!.sub, workspaceId);
    if (!roleAtLeast(role, 'editor')) return reply.code(403).send({ error: 'Editor role required' });

    const body = z
      .object({
        title: z.string().min(1).max(300).default('Untitled'),
        folderId: z.string().uuid().nullish(),
        contentMd: z.string().default(''),
        tags: z.array(z.string()).default([]),
      })
      .parse(req.body ?? {});

    const { rows } = await query(
      `insert into documents (workspace_id, folder_id, title, content_md, tags, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $6) returning *`,
      [workspaceId, body.folderId ?? null, body.title, body.contentMd, body.tags, req.user!.sub],
    );
    reply.code(201).send(rows[0]);
  });

  app.get('/documents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { doc, ok } = await requireDocRole(req.user!.sub, id, 'viewer');
    if (!doc) return reply.code(404).send({ error: 'Not found' });
    if (!ok) return reply.code(403).send({ error: 'Viewer role required' });
    return doc;
  });

  app.patch('/documents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { doc, ok } = await requireDocRole(req.user!.sub, id, 'editor');
    if (!doc) return reply.code(404).send({ error: 'Not found' });
    if (!ok) return reply.code(403).send({ error: 'Editor role required' });

    const body = z
      .object({
        title: z.string().min(1).max(300).optional(),
        contentMd: z.string().optional(),
        tags: z.array(z.string()).optional(),
        folderId: z.string().uuid().nullish(),
      })
      .parse(req.body);

    const hasFolderId = req.body != null && typeof req.body === 'object' && 'folderId' in req.body;

    const updated = await withTransaction(async (client) => {
      await recordVersion('document', id, doc, doc.updated_by, client);
      const { rows } = await client.query(
        `update documents set
           title = coalesce($1, title),
           content_md = coalesce($2, content_md),
           tags = coalesce($3, tags),
           folder_id = case when $4::boolean then $5::uuid else folder_id end,
           updated_by = $6
         where id = $7 returning *`,
        [
          body.title ?? null,
          body.contentMd ?? null,
          body.tags ?? null,
          hasFolderId,
          body.folderId ?? null,
          req.user!.sub,
          id,
        ],
      );
      return rows[0];
    });
    return updated;
  });

  app.delete('/documents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { doc, ok } = await requireDocRole(req.user!.sub, id, 'editor');
    if (!doc) return reply.code(404).send({ error: 'Not found' });
    if (!ok) return reply.code(403).send({ error: 'Editor role required' });
    await query('delete from documents where id = $1', [id]);
    reply.code(204).send();
  });

  app.get('/documents/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { doc, ok } = await requireDocRole(req.user!.sub, id, 'viewer');
    if (!doc) return reply.code(404).send({ error: 'Not found' });
    if (!ok) return reply.code(403).send({ error: 'Viewer role required' });
    reply
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${doc.title.replace(/[^\w.-]+/g, '_')}.md"`)
      .send(doc.content_md);
  });
}
