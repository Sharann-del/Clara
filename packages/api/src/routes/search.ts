import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';

/**
 * Title/tag search across every document and diagram the caller can read: items in their
 * workspaces plus items shared with them directly (permissions table). Powers the ⌘K palette.
 * An empty query returns the most recently updated items.
 */
export async function searchRoutes(app: FastifyInstance) {
  app.get('/search', async (req) => {
    const { q, limit } = z
      .object({ q: z.string().max(200).default(''), limit: z.coerce.number().int().min(1).max(50).default(20) })
      .parse(req.query);
    const term = q.trim();
    const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const { rows } = await query(
      `with readable as (
         select 'document' as kind, d.id, d.title as name, d.tags, d.workspace_id, d.folder_id, d.updated_at
           from documents d
          where d.workspace_id in (select workspace_id from workspace_members where user_id = $1)
             or d.id in (select resource_id from permissions where user_id = $1 and resource_type = 'document')
         union all
         select 'diagram', g.id, g.name, g.tags, g.workspace_id, g.folder_id, g.updated_at
           from diagrams g
          where g.workspace_id in (select workspace_id from workspace_members where user_id = $1)
             or g.id in (select resource_id from permissions where user_id = $1 and resource_type = 'diagram')
       )
       select r.*, w.name as workspace_name from readable r join workspaces w on w.id = r.workspace_id
        where $2 = '' or r.name ilike $3 or exists (select 1 from unnest(r.tags) t where t ilike $3)
        order by (lower(r.name) = lower($2)) desc, (r.name ilike $2 || '%') desc, r.updated_at desc
        limit $4`,
      [req.user!.sub, term, like, limit],
    );
    return rows;
  });
}
