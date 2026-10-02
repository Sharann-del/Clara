import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import {
  createDiagram,
  elementSchema,
  getDiagram,
  getDiagramChildren,
  getDiagramRow,
  getDiagramSource,
  listDiagrams,
  replaceElements,
  setDiagramSource,
  updateDiagramMeta,
} from '../lib/diagrams.js';
import { renderDiagramSvg, type DiagramElementRow } from '../lib/svg-export.js';

export async function diagramRoutes(app: FastifyInstance) {
  app.get('/workspaces/:workspaceId/diagrams', async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const { folderId } = req.query as { folderId?: string };
    return listDiagrams(req.user!.sub, workspaceId, folderId);
  });

  app.post('/workspaces/:workspaceId/diagrams', async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const body = z
      .object({
        name: z.string().min(1).max(300).default('Untitled diagram'),
        folderId: z.string().uuid().nullish(),
        parentDiagramId: z.string().uuid().nullish(),
        tags: z.array(z.string()).default([]),
      })
      .parse(req.body ?? {});
    reply.code(201).send(await createDiagram(req.user!.sub, workspaceId, body));
  });

  app.get('/diagrams/:id', async (req) => {
    const { id } = req.params as { id: string };
    return getDiagram(req.user!.sub, id);
  });

  app.get('/diagrams/:id/children', async (req) => {
    const { id } = req.params as { id: string };
    return getDiagramChildren(req.user!.sub, id);
  });

  app.patch('/diagrams/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        name: z.string().min(1).max(300).optional(),
        tags: z.array(z.string()).optional(),
        folderId: z.string().uuid().nullish(),
        parentDiagramId: z.string().uuid().nullish(),
      })
      .parse(req.body);

    const has = (key: string) => req.body != null && typeof req.body === 'object' && key in req.body;
    const patch: Parameters<typeof updateDiagramMeta>[2] = { name: body.name, tags: body.tags };
    if (has('folderId')) patch.folderId = body.folderId ?? null;
    if (has('parentDiagramId')) patch.parentDiagramId = body.parentDiagramId ?? null;
    return updateDiagramMeta(req.user!.sub, id, patch);
  });

  app.delete('/diagrams/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await getDiagramRow(req.user!.sub, id, 'editor');
    await query('delete from diagrams where id = $1', [id]);
    reply.code(204).send();
  });

  // Bulk replace — the canvas saves its whole element list at once.
  app.put('/diagrams/:id/elements', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ elements: z.array(elementSchema) }).parse(req.body);
    return replaceElements(req.user!.sub, id, body.elements);
  });

  app.get('/diagrams/:id/source', async (req) => {
    const { id } = req.params as { id: string };
    return getDiagramSource(req.user!.sub, id);
  });

  app.put('/diagrams/:id/source', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ dslText: z.string(), format: z.enum(['clara', 'mermaid']).default('clara') }).parse(
      req.body,
    );
    return setDiagramSource(req.user!.sub, id, body.dslText, body.format);
  });

  app.get('/diagrams/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string };
    const diagram = await getDiagramRow(req.user!.sub, id, 'viewer');

    const format = ((req.query as { format?: string }).format ?? 'svg').toLowerCase();
    if (format !== 'svg') {
      return reply
        .code(400)
        .send({ error: 'Only svg export is implemented server-side; PNG/PDF are exported client-side from the canvas.' });
    }

    const elements = await query<DiagramElementRow>(
      'select * from diagram_elements where diagram_id = $1 order by z_index',
      [id],
    );
    const svg = renderDiagramSvg(elements.rows);
    reply
      .header('Content-Type', 'image/svg+xml')
      .header('Content-Disposition', `attachment; filename="${diagram.name.replace(/[^\w.-]+/g, '_')}.svg"`)
      .send(svg);
  });
}
