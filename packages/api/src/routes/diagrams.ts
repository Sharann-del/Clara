import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { workspaceRole, roleAtLeast } from '../lib/authz.js';
import { recordVersion } from '../lib/versions.js';
import { renderDiagramSvg, type DiagramElementRow } from '../lib/svg-export.js';

async function requireDiagramRole(userId: string, diagramId: string, min: 'viewer' | 'editor') {
  const { rows } = await query('select * from diagrams where id = $1', [diagramId]);
  const diagram = rows[0];
  if (!diagram) return { diagram: undefined, role: undefined, ok: false };
  const role = await workspaceRole(userId, diagram.workspace_id);
  return { diagram, role, ok: roleAtLeast(role, min) };
}

const elementSchema = z.object({
  id: z.string().uuid().optional(),
  type: z.enum(['rect', 'ellipse', 'text', 'connector', 'group']),
  geometry: z.record(z.unknown()).default({}),
  style: z.record(z.unknown()).default({}),
  zIndex: z.number().int().default(0),
  linkedDiagramId: z.string().uuid().nullish(),
  parentGroupId: z.string().uuid().nullish(),
});

export async function diagramRoutes(app: FastifyInstance) {
  app.get('/workspaces/:workspaceId/diagrams', async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const { folderId } = req.query as { folderId?: string };
    const role = await workspaceRole(req.user!.sub, workspaceId);
    if (!role) return reply.code(403).send({ error: 'Not a member of this workspace' });

    const { rows } = folderId
      ? await query(
          'select * from diagrams where workspace_id = $1 and folder_id = $2 order by name',
          [workspaceId, folderId],
        )
      : await query('select * from diagrams where workspace_id = $1 order by name', [workspaceId]);
    return rows;
  });

  app.post('/workspaces/:workspaceId/diagrams', async (req, reply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const role = await workspaceRole(req.user!.sub, workspaceId);
    if (!roleAtLeast(role, 'editor')) return reply.code(403).send({ error: 'Editor role required' });

    const body = z
      .object({
        name: z.string().min(1).max(300).default('Untitled diagram'),
        folderId: z.string().uuid().nullish(),
        parentDiagramId: z.string().uuid().nullish(),
        tags: z.array(z.string()).default([]),
      })
      .parse(req.body ?? {});

    const diagram = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `insert into diagrams (workspace_id, folder_id, parent_diagram_id, name, tags, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $6) returning *`,
        [
          workspaceId,
          body.folderId ?? null,
          body.parentDiagramId ?? null,
          body.name,
          body.tags,
          req.user!.sub,
        ],
      );
      await client.query('insert into diagram_source (diagram_id, dsl_text, format) values ($1, $2, $3)', [
        rows[0].id,
        '',
        'clara',
      ]);
      return rows[0];
    });
    reply.code(201).send(diagram);
  });

  app.get('/diagrams/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { diagram, ok } = await requireDiagramRole(req.user!.sub, id, 'viewer');
    if (!diagram) return reply.code(404).send({ error: 'Not found' });
    if (!ok) return reply.code(403).send({ error: 'Viewer role required' });

    const elements = await query('select * from diagram_elements where diagram_id = $1 order by z_index', [
      id,
    ]);
    return { ...diagram, elements: elements.rows };
  });

  app.get('/diagrams/:id/children', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { diagram, ok } = await requireDiagramRole(req.user!.sub, id, 'viewer');
    if (!diagram) return reply.code(404).send({ error: 'Not found' });
    if (!ok) return reply.code(403).send({ error: 'Viewer role required' });
    const { rows } = await query('select id, name from diagrams where parent_diagram_id = $1 order by name', [
      id,
    ]);
    return rows;
  });

  app.patch('/diagrams/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { diagram, ok } = await requireDiagramRole(req.user!.sub, id, 'editor');
    if (!diagram) return reply.code(404).send({ error: 'Not found' });
    if (!ok) return reply.code(403).send({ error: 'Editor role required' });

    const body = z
      .object({
        name: z.string().min(1).max(300).optional(),
        tags: z.array(z.string()).optional(),
        folderId: z.string().uuid().nullish(),
        parentDiagramId: z.string().uuid().nullish(),
      })
      .parse(req.body);

    const has = (key: string) => req.body != null && typeof req.body === 'object' && key in req.body;

    const { rows } = await query(
      `update diagrams set
         name = coalesce($1, name),
         tags = coalesce($2, tags),
         folder_id = case when $3::boolean then $4::uuid else folder_id end,
         parent_diagram_id = case when $5::boolean then $6::uuid else parent_diagram_id end,
         updated_by = $7
       where id = $8 returning *`,
      [
        body.name ?? null,
        body.tags ?? null,
        has('folderId'),
        body.folderId ?? null,
        has('parentDiagramId'),
        body.parentDiagramId ?? null,
        req.user!.sub,
        id,
      ],
    );
    return rows[0];
  });

  app.delete('/diagrams/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { diagram, ok } = await requireDiagramRole(req.user!.sub, id, 'editor');
    if (!diagram) return reply.code(404).send({ error: 'Not found' });
    if (!ok) return reply.code(403).send({ error: 'Editor role required' });
    await query('delete from diagrams where id = $1', [id]);
    reply.code(204).send();
  });

  // Bulk replace — the canvas saves its whole element list at once.
  app.put('/diagrams/:id/elements', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { diagram, ok } = await requireDiagramRole(req.user!.sub, id, 'editor');
    if (!diagram) return reply.code(404).send({ error: 'Not found' });
    if (!ok) return reply.code(403).send({ error: 'Editor role required' });

    const body = z.object({ elements: z.array(elementSchema) }).parse(req.body);

    const elements = await withTransaction(async (client) => {
      const prior = await client.query('select * from diagram_elements where diagram_id = $1', [id]);
      await recordVersion(
        'diagram',
        id,
        { diagram, elements: prior.rows },
        diagram.updated_by,
        client,
      );

      await client.query('delete from diagram_elements where diagram_id = $1', [id]);

      const inserted = [];
      for (const el of body.elements) {
        const { rows } = await client.query(
          `insert into diagram_elements
             (id, diagram_id, type, geometry, style, z_index, linked_diagram_id, parent_group_id)
           values (coalesce($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8)
           returning *`,
          [
            el.id ?? null,
            id,
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
      await client.query('update diagrams set updated_by = $1 where id = $2', [req.user!.sub, id]);
      return inserted;
    });

    return elements;
  });

  app.get('/diagrams/:id/source', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { diagram, ok } = await requireDiagramRole(req.user!.sub, id, 'viewer');
    if (!diagram) return reply.code(404).send({ error: 'Not found' });
    if (!ok) return reply.code(403).send({ error: 'Viewer role required' });
    const { rows } = await query('select * from diagram_source where diagram_id = $1', [id]);
    return rows[0] ?? { diagram_id: id, dsl_text: '', format: 'clara' };
  });

  app.put('/diagrams/:id/source', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { diagram, ok } = await requireDiagramRole(req.user!.sub, id, 'editor');
    if (!diagram) return reply.code(404).send({ error: 'Not found' });
    if (!ok) return reply.code(403).send({ error: 'Editor role required' });

    const body = z.object({ dslText: z.string(), format: z.enum(['clara', 'mermaid']).default('clara') }).parse(
      req.body,
    );

    const { rows } = await query(
      `insert into diagram_source (diagram_id, dsl_text, format, updated_at) values ($1, $2, $3, now())
       on conflict (diagram_id) do update set dsl_text = excluded.dsl_text, format = excluded.format, updated_at = now()
       returning *`,
      [id, body.dslText, body.format],
    );
    return rows[0];
  });

  app.get('/diagrams/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { diagram, ok } = await requireDiagramRole(req.user!.sub, id, 'viewer');
    if (!diagram) return reply.code(404).send({ error: 'Not found' });
    if (!ok) return reply.code(403).send({ error: 'Viewer role required' });

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
