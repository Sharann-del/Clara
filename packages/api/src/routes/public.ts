import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { embeddedDiagrams } from '@clara/shared/embeds';
import { listStates } from '../lib/states.js';
import { renderDiagramSvg, type DiagramElementRow } from '../lib/svg-export.js';

/** Distinct diagram ids a document embeds; only these are readable through its public link. */
export function embeddedDiagramIds(markdown: string): string[] {
  return [...new Set(embeddedDiagrams(markdown).map((r) => r.id))];
}

interface LinkRow {
  resource_type: 'document' | 'diagram';
  resource_id: string;
}

async function resolveLink(token: string): Promise<LinkRow | undefined> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return undefined;
  const { rows } = await query<LinkRow>(
    'select resource_type, resource_id from share_links where token = $1 and revoked_at is null',
    [token],
  );
  return rows[0];
}

async function publicDiagram(id: string) {
  const { rows } = await query('select id, name, workspace_id, updated_at from diagrams where id = $1', [id]);
  if (!rows[0]) return undefined;
  const els = await query('select * from diagram_elements where diagram_id = $1 order by z_index', [id]);
  const states = await listStates(id);
  return {
    id: rows[0].id,
    name: rows[0].name,
    updated_at: rows[0].updated_at,
    workspace_id: rows[0].workspace_id as string,
    elements: els.rows,
    states: states.map((s) => ({ id: s.id, name: s.name, order_index: s.order_index, element_overrides: s.element_overrides })),
  };
}

/**
 * Unauthenticated, read-only access through a share link token. A document link also grants
 * read access to the diagrams that document embeds (same workspace only), so embeds render;
 * nothing else in the workspace is reachable. Drill-down links on a shared diagram are not
 * followed: the child diagram needs its own link.
 */
export async function publicRoutes(app: FastifyInstance) {
  app.get('/public/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex');
    const link = await resolveLink(token);
    if (!link) return reply.code(404).send({ error: 'This link was revoked or never existed' });
    if (link.resource_type === 'document') {
      const { rows } = await query('select id, title, content_md, tags, updated_at from documents where id = $1', [link.resource_id]);
      if (!rows[0]) return reply.code(404).send({ error: 'This link was revoked or never existed' });
      return { kind: 'document', document: rows[0] };
    }
    const diagram = await publicDiagram(link.resource_id);
    if (!diagram) return reply.code(404).send({ error: 'This link was revoked or never existed' });
    const { workspace_id: _ws, ...rest } = diagram;
    return { kind: 'diagram', diagram: rest };
  });

  app.get('/public/:token/diagrams/:diagramId', async (req, reply) => {
    const { token, diagramId } = req.params as { token: string; diagramId: string };
    reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex');
    const link = await resolveLink(token);
    const notFound = () => reply.code(404).send({ error: 'Not found' });
    if (!link || link.resource_type !== 'document') return notFound();
    const { rows } = await query<{ content_md: string; workspace_id: string }>(
      'select content_md, workspace_id from documents where id = $1',
      [link.resource_id],
    );
    if (!rows[0] || !embeddedDiagramIds(rows[0].content_md).includes(diagramId.toLowerCase())) return notFound();
    const diagram = await publicDiagram(diagramId);
    if (!diagram || diagram.workspace_id !== rows[0].workspace_id) return notFound();
    const { workspace_id: _ws, ...rest } = diagram;
    return rest;
  });

  app.get('/public/:token/export.svg', async (req, reply) => {
    const { token } = req.params as { token: string };
    const link = await resolveLink(token);
    if (!link || link.resource_type !== 'diagram') return reply.code(404).send({ error: 'Not found' });
    const els = await query<DiagramElementRow>('select * from diagram_elements where diagram_id = $1 order by z_index', [link.resource_id]);
    reply.header('Content-Type', 'image/svg+xml').header('X-Robots-Tag', 'noindex').send(renderDiagramSvg(els.rows));
  });
}
