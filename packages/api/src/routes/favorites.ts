import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { BadRequestError } from '../lib/authz.js';
import { loadDocument } from '../lib/documents.js';
import { loadDiagram } from '../lib/diagrams.js';

const kindOf = (k: string) => {
  if (k !== 'document' && k !== 'diagram') throw new BadRequestError('kind must be document or diagram');
  return k;
};

/** Starred items per user. The list only returns items the user can still read. */
export async function favoriteRoutes(app: FastifyInstance) {
  app.get('/favorites', async (req) => {
    const { rows } = await query(
      `select f.resource_type as kind, f.resource_id as id, coalesce(d.title, g.name) as name, f.created_at
         from favorites f
         left join documents d on f.resource_type = 'document' and d.id = f.resource_id
         left join diagrams g on f.resource_type = 'diagram' and g.id = f.resource_id
        where f.user_id = $1
          and coalesce(d.workspace_id, g.workspace_id) is not null
          and (coalesce(d.workspace_id, g.workspace_id) in (select workspace_id from workspace_members where user_id = $1)
               or exists (select 1 from permissions p where p.user_id = $1 and p.resource_type = f.resource_type and p.resource_id = f.resource_id))
        order by f.created_at desc`,
      [req.user!.sub],
    );
    return rows;
  });

  app.put('/favorites/:kind/:id', async (req, reply) => {
    const { kind, id } = req.params as { kind: string; id: string };
    if (kindOf(kind) === 'document') await loadDocument(req.user!.sub, id);
    else await loadDiagram(req.user!.sub, id);
    await query('insert into favorites (user_id, resource_type, resource_id) values ($1, $2, $3) on conflict do nothing', [req.user!.sub, kind, id]);
    reply.code(204).send();
  });

  app.delete('/favorites/:kind/:id', async (req, reply) => {
    const { kind, id } = req.params as { kind: string; id: string };
    await query('delete from favorites where user_id = $1 and resource_type = $2 and resource_id = $3', [req.user!.sub, kindOf(kind), id]);
    reply.code(204).send();
  });
}
