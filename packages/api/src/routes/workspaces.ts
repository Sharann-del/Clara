import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { workspaceRole, roleAtLeast } from '../lib/authz.js';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { config } from '../config.js';

const cognito = new CognitoIdentityProviderClient({ region: config.awsRegion });

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
      const { rows } = await client.query(
        'insert into workspaces (name) values ($1) returning *',
        [body.name],
      );
      await client.query(
        'insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)',
        [rows[0].id, req.user!.sub, 'owner'],
      );
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
    const { rows } = await query('update workspaces set name = $1 where id = $2 returning *', [
      body.name,
      id,
    ]);
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
    // Cognito is the identity source, so resolve emails per member (workspaces are small).
    return Promise.all(
      rows.map(async (m) => {
        try {
          const r = await cognito.send(
            new ListUsersCommand({ UserPoolId: config.userPoolId, Filter: `sub = "${m.user_id}"`, Limit: 1 }),
          );
          const email = r.Users?.[0]?.Attributes?.find((a) => a.Name === 'email')?.Value;
          return { ...m, email };
        } catch {
          return { ...m, email: undefined };
        }
      }),
    );
  });

  app.post('/workspaces/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    const role = await workspaceRole(req.user!.sub, id);
    if (!roleAtLeast(role, 'admin')) return reply.code(403).send({ error: 'Admin role required' });

    const body = z
      .object({ email: z.string().email(), role: z.enum(['editor', 'viewer']) })
      .parse(req.body);

    const result = await cognito.send(
      new ListUsersCommand({
        UserPoolId: config.userPoolId,
        Filter: `email = "${body.email.replace(/"/g, '')}"`,
        Limit: 1,
      }),
    );
    const sub = result.Users?.[0]?.Attributes?.find((a) => a.Name === 'sub')?.Value;
    if (!sub) return reply.code(404).send({ error: `No user found with email ${body.email}` });

    const existing = await workspaceRole(sub, id);
    if (existing === 'owner' || existing === 'admin') {
      return reply.code(409).send({ error: `${body.email} is already an ${existing} of this workspace` });
    }

    await query(
      `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)
       on conflict (workspace_id, user_id) do update set role = excluded.role`,
      [id, sub, body.role],
    );
    reply.code(201).send({ userId: sub, role: body.role });
  });
}
