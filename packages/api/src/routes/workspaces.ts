import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import {
  assertWorkspaceRole,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  workspaceRole,
  roleAtLeast,
} from '../lib/authz.js';
import { emailForUser, findUserIdByEmail } from '../lib/users.js';

export async function workspaceRoutes(app: FastifyInstance) {
  app.get('/workspaces', async (req) => {
    const { rows } = await query(
      `select w.* from workspaces w
       join workspace_members m on m.workspace_id = w.id
       where m.user_id = $1
       order by w.created_at desc`,
      [req.user!.sub],
    );
    return rows;
  });

  app.post('/workspaces', async (req, reply) => {
    const body = z.object({ name: z.string().min(1).max(200) }).parse(req.body);
    const workspace = await withTransaction(async (client) => {
      const { rows } = await client.query('insert into workspaces (name) values ($1) returning *', [body.name]);
      await client.query('insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)', [
        rows[0].id,
        req.user!.sub,
        'owner',
      ]);
      return rows[0];
    });
    reply.code(201).send(workspace);
  });

  app.get('/workspaces/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const role = await workspaceRole(req.user!.sub, id);
    if (!role) return reply.code(403).send({ error: 'Not a member of this workspace' });
    const { rows } = await query('select * from workspaces where id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    return { ...rows[0], role };
  });

  app.patch('/workspaces/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const role = await workspaceRole(req.user!.sub, id);
    if (!roleAtLeast(role, 'admin')) return reply.code(403).send({ error: 'Admin role required' });
    const body = z.object({ name: z.string().min(1).max(200) }).parse(req.body);
    const { rows } = await query('update workspaces set name = $1 where id = $2 returning *', [body.name, id]);
    return rows[0];
  });

  app.delete('/workspaces/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const role = await workspaceRole(req.user!.sub, id);
    if (!roleAtLeast(role, 'owner')) return reply.code(403).send({ error: 'Owner role required' });
    await query('delete from workspaces where id = $1', [id]);
    reply.code(204).send();
  });

  app.get('/workspaces/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    const role = await workspaceRole(req.user!.sub, id);
    if (!role) return reply.code(403).send({ error: 'Not a member of this workspace' });
    const { rows } = await query<{ user_id: string; role: string; created_at: string }>(
      'select user_id, role, created_at from workspace_members where workspace_id = $1 order by created_at',
      [id],
    );
    return Promise.all(rows.map(async (m) => ({ ...m, email: await emailForUser(m.user_id) })));
  });

  app.post('/workspaces/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    const role = await workspaceRole(req.user!.sub, id);
    if (!roleAtLeast(role, 'admin')) return reply.code(403).send({ error: 'Admin role required' });
    const body = z.object({ email: z.string().email(), role: z.enum(['admin', 'editor', 'viewer']) }).parse(req.body);
    const sub = await findUserIdByEmail(body.email);
    const existing = await workspaceRole(sub, id);
    if (existing) {
      return reply.code(409).send({
        error: `${body.email} is already ${existing === 'admin' || existing === 'owner' ? 'an' : 'a'} ${existing} here. Change their role in the list instead.`,
      });
    }
    await query('insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)', [
      id,
      sub,
      body.role,
    ]);
    reply.code(201).send({ userId: sub, role: body.role, email: body.email.trim().toLowerCase() });
  });

  /**
   * Change a member's role. Admins manage admins/editors/viewers; only owners can make or
   * unmake owners; the last owner can't be demoted (there must always be one).
   */
  app.patch('/workspaces/:id/members/:userId', async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const actorRole = await assertWorkspaceRole(req.user!.sub, id, 'admin');
    const { role: next } = z.object({ role: z.enum(['owner', 'admin', 'editor', 'viewer']) }).parse(req.body);
    const current = await workspaceRole(userId, id);
    if (!current) throw new NotFoundError('Not a member of this workspace');
    if ((current === 'owner' || next === 'owner') && actorRole !== 'owner')
      throw new ForbiddenError('Only an owner can change owners');
    if (current === 'owner' && next !== 'owner') await assertAnotherOwner(id, userId);
    const { rows } = await query(
      'update workspace_members set role = $1 where workspace_id = $2 and user_id = $3 returning user_id, role, created_at',
      [next, id, userId],
    );
    return rows[0];
  });

  /** Remove someone (admin+), or yourself (leave). Owners can only be removed by owners; never the last one. */
  app.delete('/workspaces/:id/members/:userId', async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const self = userId === req.user!.sub;
    const target = await workspaceRole(userId, id);
    if (!target) throw new NotFoundError('Not a member of this workspace');
    if (!self) {
      const actorRole = await assertWorkspaceRole(req.user!.sub, id, 'admin');
      if (target === 'owner' && actorRole !== 'owner') throw new ForbiddenError('Only an owner can remove an owner');
    }
    if (target === 'owner') await assertAnotherOwner(id, userId);
    await query('delete from workspace_members where workspace_id = $1 and user_id = $2', [id, userId]);
    reply.code(204).send();
  });
}

async function assertAnotherOwner(workspaceId: string, exceptUserId: string) {
  const { rows } = await query<{ n: string }>(
    "select count(*) as n from workspace_members where workspace_id = $1 and role = 'owner' and user_id <> $2",
    [workspaceId, exceptUserId],
  );
  if (Number(rows[0].n) === 0) {
    throw new BadRequestError(
      'A workspace needs at least one owner. Make someone else an owner first, or delete the workspace.',
    );
  }
}
