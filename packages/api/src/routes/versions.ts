import type { FastifyInstance } from 'fastify';
import { query, withTransaction } from '../db.js';
import { effectiveResourceRole, roleAtLeast, type Role } from '../lib/authz.js';
import { recordVersion } from '../lib/versions.js';
import { listStates } from '../lib/states.js';

interface OwnedResource {
  workspace_id: string;
  [key: string]: unknown;
}

async function loadOwner(resourceType: 'document' | 'diagram', id: string): Promise<OwnedResource | undefined> {
  const table = resourceType === 'document' ? 'documents' : 'diagrams';
  const { rows } = await query<OwnedResource>(`select * from ${table} where id = $1`, [id]);
  return rows[0];
}

async function checkRole(userId: string, resourceType: 'document' | 'diagram', resource: OwnedResource & { id?: unknown }, min: Role) {
  const role = await effectiveResourceRole(userId, resource.workspace_id, resourceType, String(resource.id));
  return roleAtLeast(role, min);
}

export async function versionRoutes(app: FastifyInstance) {
  for (const resourceType of ['document', 'diagram'] as const) {
    const base = resourceType === 'document' ? 'documents' : 'diagrams';

    app.get(`/${base}/:id/versions`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const resource = await loadOwner(resourceType, id);
      if (!resource) return reply.code(404).send({ error: 'Not found' });
      if (!(await checkRole(req.user!.sub, resourceType, resource, 'viewer')))
        return reply.code(403).send({ error: 'Viewer role required' });

      const { rows } = await query(
        'select id, created_at, created_by from versions where resource_type = $1 and resource_id = $2 order by created_at desc',
        [resourceType, id],
      );
      return rows;
    });

    // Full snapshot of one version, for previewing / diffing before a restore.
    app.get(`/${base}/:id/versions/:versionId`, async (req, reply) => {
      const { id, versionId } = req.params as { id: string; versionId: string };
      const resource = await loadOwner(resourceType, id);
      if (!resource) return reply.code(404).send({ error: 'Not found' });
      if (!(await checkRole(req.user!.sub, resourceType, resource, 'viewer')))
        return reply.code(403).send({ error: 'Viewer role required' });
      const { rows } = await query(
        'select id, created_at, created_by, snapshot from versions where id = $1 and resource_type = $2 and resource_id = $3',
        [versionId, resourceType, id],
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Version not found' });
      return rows[0];
    });

    app.post(`/${base}/:id/versions/:versionId/restore`, async (req, reply) => {
      const { id, versionId } = req.params as { id: string; versionId: string };
      const resource = await loadOwner(resourceType, id);
      if (!resource) return reply.code(404).send({ error: 'Not found' });
      if (!(await checkRole(req.user!.sub, resourceType, resource, 'editor')))
        return reply.code(403).send({ error: 'Editor role required' });

      const versionRows = await query(
        'select * from versions where id = $1 and resource_type = $2 and resource_id = $3',
        [versionId, resourceType, id],
      );
      const version = versionRows.rows[0];
      if (!version) return reply.code(404).send({ error: 'Version not found' });

      const snapshot = version.snapshot as Record<string, unknown>;

      const restored = await withTransaction(async (client) => {
        if (resourceType === 'document') {
          await recordVersion('document', id, resource, req.user!.sub, client);
          const { rows } = await client.query(
            'update documents set title = $1, content_md = $2, tags = $3, updated_by = $4 where id = $5 returning *',
            [snapshot.title, snapshot.content_md, snapshot.tags, req.user!.sub, id],
          );
          return rows[0];
        } else {
          const currentElements = await client.query(
            'select * from diagram_elements where diagram_id = $1',
            [id],
          );
          await recordVersion(
            'diagram',
            id,
            { diagram: resource, elements: currentElements.rows, states: await listStates(id, client) },
            req.user!.sub,
            client,
          );

          const diagramSnapshot = (snapshot.diagram ?? snapshot) as Record<string, unknown>;
          await client.query('update diagrams set name = $1, tags = $2, updated_by = $3 where id = $4', [
            diagramSnapshot.name,
            diagramSnapshot.tags,
            req.user!.sub,
            id,
          ]);

          await client.query('delete from diagram_elements where diagram_id = $1', [id]);
          const elements = (snapshot.elements ?? []) as Array<Record<string, unknown>>;
          for (const el of elements) {
            await client.query(
              `insert into diagram_elements (id, diagram_id, type, geometry, style, z_index, linked_diagram_id, parent_group_id)
               values ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                el.id,
                id,
                el.type,
                JSON.stringify(el.geometry),
                JSON.stringify(el.style),
                el.z_index ?? 0,
                el.linked_diagram_id ?? null,
                el.parent_group_id ?? null,
              ],
            );
          }

          // Snapshots from before milestone 3 carry no `states` key — leave current states alone then.
          if (Array.isArray(snapshot.states)) {
            await client.query('delete from diagram_states where diagram_id = $1', [id]);
            for (const st of snapshot.states as Array<Record<string, unknown>>) {
              await client.query(
                `insert into diagram_states (id, diagram_id, name, order_index, element_overrides)
                 values ($1, $2, $3, $4, $5)`,
                [st.id, id, st.name, st.order_index ?? 0, JSON.stringify(st.element_overrides ?? {})],
              );
            }
          }

          const { rows } = await client.query('select * from diagrams where id = $1', [id]);
          return rows[0];
        }
      });

      return restored;
    });
  }
}
