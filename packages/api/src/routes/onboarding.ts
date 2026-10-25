import type { FastifyInstance } from 'fastify';
import { withTransaction } from '../db.js';
import { layoutToElements, parseClaraDsl } from '@clara/shared/dsl';
import { SAMPLE_DIAGRAM_DSL, SAMPLE_DIAGRAM_NAME, WELCOME_TITLE, welcomeMarkdown } from '@clara/shared/onboarding';
import { elementSchema, writeElements, upsertSource } from '../lib/diagrams.js';

/**
 * First-run setup, at most once per account: a workspace with a welcome document and a sample
 * diagram. Accounts that were already set up, or that already belong to a workspace, get
 * `created: false` (and are recorded as set up). A per-user advisory lock makes concurrent
 * calls (two tabs, React StrictMode's double effect) create one workspace, not two.
 */
export async function onboardingRoutes(app: FastifyInstance) {
  app.post('/onboarding', async (req) => {
    const userId = req.user!.sub;
    return withTransaction(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`onboarding:${userId}`]);
      const { rows: existing } = await c.query(
        'select workspace_id from workspace_members where user_id = $1 order by created_at limit 1',
        [userId],
      );
      const { rowCount: already } = await c.query('select 1 from onboarded_users where user_id = $1', [userId]);
      if (already || existing[0]) {
        await c.query('insert into onboarded_users (user_id) values ($1) on conflict do nothing', [userId]);
        return { created: false, workspaceId: existing[0]?.workspace_id ?? null };
      }
      await c.query('insert into onboarded_users (user_id) values ($1)', [userId]);

      const { rows: ws } = await c.query("insert into workspaces (name) values ('My workspace') returning *");
      const workspaceId = ws[0].id as string;
      await c.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [
        workspaceId,
        userId,
      ]);

      const { rows: dg } = await c.query(
        `insert into diagrams (workspace_id, name, tags, created_by, updated_by) values ($1, $2, $3, $4, $4) returning id`,
        [workspaceId, SAMPLE_DIAGRAM_NAME, ['sample'], userId],
      );
      const diagramId = dg[0].id as string;
      const elements = layoutToElements(parseClaraDsl(SAMPLE_DIAGRAM_DSL)).map((e) => elementSchema.parse(e));
      await writeElements(c, diagramId, elements, userId);
      await upsertSource(c, diagramId, SAMPLE_DIAGRAM_DSL, 'clara');

      const { rows: doc } = await c.query(
        `insert into documents (workspace_id, title, content_md, tags, created_by, updated_by) values ($1, $2, $3, $4, $5, $5) returning id`,
        [workspaceId, WELCOME_TITLE, welcomeMarkdown(diagramId), ['getting-started'], userId],
      );
      return { created: true, workspaceId, documentId: doc[0].id as string, diagramId };
    });
  });
}
