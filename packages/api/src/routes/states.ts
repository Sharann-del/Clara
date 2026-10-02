import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { workspaceRole, roleAtLeast } from '../lib/authz.js';
import { createState, elementOverrideSchema, listStates, setElementOverride } from '../lib/states.js';

async function requireDiagramRole(userId: string, diagramId: string, min: 'viewer' | 'editor') {
  const { rows } = await query('select * from diagrams where id = $1', [diagramId]);
  const diagram = rows[0];
  if (!diagram) return { diagram: undefined, ok: false };
  const role = await workspaceRole(userId, diagram.workspace_id);
  return { diagram, ok: roleAtLeast(role, min) };
}

/** Resolves a state to its diagram so state-addressed routes can reuse the diagram role check. */
async function loadState(stateId: string) {
  const { rows } = await query('select * from diagram_states where id = $1', [stateId]);
  return rows[0] as { id: string; diagram_id: string } | undefined;
}

export async function stateRoutes(app: FastifyInstance) {
  app.get('/diagrams/:id/states', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { diagram, ok } = await requireDiagramRole(req.user!.sub, id, 'viewer');
    if (!diagram) return reply.code(404).send({ error: 'Not found' });
    if (!ok) return reply.code(403).send({ error: 'Viewer role required' });
    return listStates(id);
  });

  app.post('/diagrams/:id/states', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { diagram, ok } = await requireDiagramRole(req.user!.sub, id, 'editor');
    if (!diagram) return reply.code(404).send({ error: 'Not found' });
    if (!ok) return reply.code(403).send({ error: 'Editor role required' });

    const body = z
      .object({
        name: z.string().min(1).max(100),
        // Optionally start from a copy of another state's overrides (e.g. "interim" from "current").
        copyFromStateId: z.string().uuid().optional(),
      })
      .parse(req.body);

    const state = await withTransaction(async (client) => {
      const created = await createState(id, body.name, client);
      if (body.copyFromStateId) {
        const { rows } = await client.query(
          `update diagram_states set element_overrides =
             (select element_overrides from diagram_states where id = $1 and diagram_id = $2)
           where id = $3 returning *`,
          [body.copyFromStateId, id, created.id],
        );
        return rows[0] ?? created;
      }
      return created;
    });
    reply.code(201).send(state);
  });

  // Reorder: body is the full ordered list of state ids for the diagram.
  app.put('/diagrams/:id/states/order', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { diagram, ok } = await requireDiagramRole(req.user!.sub, id, 'editor');
    if (!diagram) return reply.code(404).send({ error: 'Not found' });
    if (!ok) return reply.code(403).send({ error: 'Editor role required' });

    const { stateIds } = z.object({ stateIds: z.array(z.string().uuid()) }).parse(req.body);
    return withTransaction(async (client) => {
      const existing = await listStates(id, client);
      const known = new Set(existing.map((s) => s.id));
      if (stateIds.length !== known.size || !stateIds.every((s) => known.has(s)) || new Set(stateIds).size !== known.size) {
        throw Object.assign(new Error('stateIds must list every state of this diagram exactly once'), { statusCode: 400 });
      }
      for (let i = 0; i < stateIds.length; i++) {
        await client.query('update diagram_states set order_index = $1 where id = $2', [i, stateIds[i]]);
      }
      return listStates(id, client);
    });
  });

  app.patch('/diagram-states/:stateId', async (req, reply) => {
    const { stateId } = req.params as { stateId: string };
    const state = await loadState(stateId);
    if (!state) return reply.code(404).send({ error: 'Not found' });
    const { ok } = await requireDiagramRole(req.user!.sub, state.diagram_id, 'editor');
    if (!ok) return reply.code(403).send({ error: 'Editor role required' });

    const body = z.object({ name: z.string().min(1).max(100) }).parse(req.body);
    const { rows } = await query('update diagram_states set name = $1 where id = $2 returning *', [body.name, stateId]);
    return rows[0];
  });

  app.put('/diagram-states/:stateId/overrides/:elementId', async (req, reply) => {
    const { stateId, elementId } = req.params as { stateId: string; elementId: string };
    const state = await loadState(stateId);
    if (!state) return reply.code(404).send({ error: 'Not found' });
    const { ok } = await requireDiagramRole(req.user!.sub, state.diagram_id, 'editor');
    if (!ok) return reply.code(403).send({ error: 'Editor role required' });

    const body = z.object({ override: elementOverrideSchema.nullable() }).parse(req.body);
    return setElementOverride(state.diagram_id, stateId, elementId, body.override);
  });

  app.delete('/diagram-states/:stateId', async (req, reply) => {
    const { stateId } = req.params as { stateId: string };
    const state = await loadState(stateId);
    if (!state) return reply.code(404).send({ error: 'Not found' });
    const { ok } = await requireDiagramRole(req.user!.sub, state.diagram_id, 'editor');
    if (!ok) return reply.code(403).send({ error: 'Editor role required' });
    await query('delete from diagram_states where id = $1', [stateId]);
    reply.code(204).send();
  });
}
