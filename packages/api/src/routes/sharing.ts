import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { query } from '../db.js';
import { BadRequestError, NotFoundError, workspaceRole, type ResourceKind } from '../lib/authz.js';
import { loadDocument } from '../lib/documents.js';
import { loadDiagram } from '../lib/diagrams.js';
import { emailForUser, findUserIdByEmail } from '../lib/users.js';

const kinds = { documents: 'document', diagrams: 'diagram' } as const;

/** Anyone who can edit an item can share it (like most document tools). */
async function loadForSharing(userId: string, kind: ResourceKind, id: string, min: 'viewer' | 'editor' = 'editor') {
  return kind === 'document' ? (await loadDocument(userId, id, min)).doc : (await loadDiagram(userId, id, min)).diagram;
}

/**
 * Per-item sharing (PRD 4.1): direct grants in `permissions`, enforced wherever an item is
 * loaded (lib/authz assertResourceRole) — REST, MCP and the realtime socket. Plus public
 * read-only links (`share_links`) that anyone can open via GET /public/:token.
 */
export async function sharingRoutes(app: FastifyInstance) {
  for (const [base, kind] of Object.entries(kinds)) {
    app.get(`/${base}/:id/permissions`, async (req) => {
      const { id } = req.params as { id: string };
      const item = await loadForSharing(req.user!.sub, kind, id, 'viewer');
      const { rows } = await query<{ user_id: string; role: string; created_at: string }>(
        'select user_id, role, created_at from permissions where resource_type = $1 and resource_id = $2 order by created_at',
        [kind, id],
      );
      const grants = await Promise.all(
        rows.map(async (r) => ({
          ...r,
          email: await emailForUser(r.user_id),
          workspace_role: (await workspaceRole(r.user_id, item.workspace_id)) ?? null,
        })),
      );
      return grants;
    });

    app.post(`/${base}/:id/permissions`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({ email: z.string().email(), role: z.enum(['viewer', 'editor']) }).parse(req.body);
      await loadForSharing(req.user!.sub, kind, id);
      const userId = await findUserIdByEmail(body.email);
      if (userId === req.user!.sub) throw new BadRequestError('You already have access to this');
      const { rows } = await query(
        `insert into permissions (resource_id, resource_type, user_id, role) values ($1, $2, $3, $4)
         on conflict (resource_id, resource_type, user_id) do update set role = excluded.role returning user_id, role, created_at`,
        [id, kind, userId, body.role],
      );
      reply.code(201).send({ ...rows[0], email: body.email.trim().toLowerCase() });
    });

    app.patch(`/${base}/:id/permissions/:userId`, async (req) => {
      const { id, userId } = req.params as { id: string; userId: string };
      const body = z.object({ role: z.enum(['viewer', 'editor']) }).parse(req.body);
      await loadForSharing(req.user!.sub, kind, id);
      const { rows } = await query(
        'update permissions set role = $1 where resource_type = $2 and resource_id = $3 and user_id = $4 returning user_id, role, created_at',
        [body.role, kind, id, userId],
      );
      if (!rows[0]) throw new NotFoundError('That person has no direct access to revoke or change');
      return rows[0];
    });

    app.delete(`/${base}/:id/permissions/:userId`, async (req, reply) => {
      const { id, userId } = req.params as { id: string; userId: string };
      // People may always remove their own access; otherwise editors manage sharing.
      if (userId !== req.user!.sub) await loadForSharing(req.user!.sub, kind, id);
      await query('delete from permissions where resource_type = $1 and resource_id = $2 and user_id = $3', [
        kind,
        id,
        userId,
      ]);
      reply.code(204).send();
    });

    app.get(`/${base}/:id/share-links`, async (req) => {
      const { id } = req.params as { id: string };
      await loadForSharing(req.user!.sub, kind, id, 'viewer');
      const { rows } = await query(
        `select id, token, created_at, created_by from share_links
          where resource_type = $1 and resource_id = $2 and revoked_at is null order by created_at desc`,
        [kind, id],
      );
      return rows;
    });

    app.post(`/${base}/:id/share-links`, async (req, reply) => {
      const { id } = req.params as { id: string };
      await loadForSharing(req.user!.sub, kind, id);
      const { rows } = await query(
        `insert into share_links (token, resource_type, resource_id, created_by) values ($1, $2, $3, $4)
         returning id, token, created_at, created_by`,
        [randomBytes(24).toString('base64url'), kind, id, req.user!.sub],
      );
      reply.code(201).send(rows[0]);
    });
  }

  app.delete('/share-links/:linkId', async (req, reply) => {
    const { linkId } = req.params as { linkId: string };
    const { rows } = await query<{ resource_type: ResourceKind; resource_id: string }>(
      'select resource_type, resource_id from share_links where id = $1 and revoked_at is null',
      [linkId],
    );
    if (!rows[0]) throw new NotFoundError('Link not found or already revoked');
    await loadForSharing(req.user!.sub, rows[0].resource_type, rows[0].resource_id);
    await query('update share_links set revoked_at = now() where id = $1', [linkId]);
    reply.code(204).send();
  });

  /** Items shared with the caller directly (not via a workspace they belong to). */
  app.get('/shared-with-me', async (req) => {
    const { rows } = await query(
      `select 'document' as kind, d.id, d.title as name, d.tags, d.updated_at, p.role, w.name as workspace_name
         from permissions p join documents d on d.id = p.resource_id join workspaces w on w.id = d.workspace_id
        where p.user_id = $1 and p.resource_type = 'document'
       union all
       select 'diagram', g.id, g.name, g.tags, g.updated_at, p.role, w.name
         from permissions p join diagrams g on g.id = p.resource_id join workspaces w on w.id = g.workspace_id
        where p.user_id = $1 and p.resource_type = 'diagram'
       order by updated_at desc`,
      [req.user!.sub],
    );
    return rows;
  });
}
