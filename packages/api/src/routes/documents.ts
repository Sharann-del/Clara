import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import {
  createDocument,
  getDocument,
  listDocuments,
  updateDocument,
} from '../lib/documents.js';

export async function documentRoutes(app: FastifyInstance) {
  app.get('/workspaces/:workspaceId/documents', async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const { folderId } = req.query as { folderId?: string };
    return listDocuments(req.user!.sub, workspaceId, folderId);
  });

  app.post('/workspaces/:workspaceId/documents', async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const body = z
      .object({
        title: z.string().min(1).max(300).default('Untitled'),
        folderId: z.string().uuid().nullish(),
        contentMd: z.string().default(''),
        tags: z.array(z.string()).default([]),
      })
      .parse(req.body ?? {});
    reply.code(201).send(await createDocument(req.user!.sub, workspaceId, body));
  });

  app.get('/documents/:id', async (req) => {
    const { id } = req.params as { id: string };
    return getDocument(req.user!.sub, id, 'viewer');
  });

  app.patch('/documents/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        title: z.string().min(1).max(300).optional(),
        contentMd: z.string().optional(),
        tags: z.array(z.string()).optional(),
        folderId: z.string().uuid().nullish(),
      })
      .parse(req.body);
    const hasFolderId = req.body != null && typeof req.body === 'object' && 'folderId' in req.body;
    const { folderId, ...rest } = body;
    return updateDocument(req.user!.sub, id, hasFolderId ? { ...rest, folderId: folderId ?? null } : rest);
  });

  app.delete('/documents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await getDocument(req.user!.sub, id, 'editor');
    await query('delete from documents where id = $1', [id]);
    reply.code(204).send();
  });

  app.get('/documents/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = await getDocument(req.user!.sub, id, 'viewer');
    reply
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${doc.title.replace(/[^\w.-]+/g, '_')}.md"`)
      .send(doc.content_md);
  });
}
