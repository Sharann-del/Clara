import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { acceptChange, countPendingChanges, listPendingChanges, rejectChange } from '../lib/pending.js';

export async function pendingChangeRoutes(app: FastifyInstance) {
  app.get('/workspaces/:workspaceId/pending-changes', async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const { status } = z
      .object({ status: z.enum(['pending', 'accepted', 'rejected']).default('pending') })
      .parse(req.query);
    return listPendingChanges(req.user!.sub, workspaceId, status);
  });

  app.get('/workspaces/:workspaceId/pending-changes/count', async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    return { count: await countPendingChanges(req.user!.sub, workspaceId) };
  });

  app.post('/pending-changes/:id/accept', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ force: z.boolean().default(false) }).parse(req.body ?? {});
    return acceptChange(req.user!.sub, id, { force: body.force });
  });

  app.post('/pending-changes/:id/reject', async (req) => {
    const { id } = req.params as { id: string };
    return rejectChange(req.user!.sub, id);
  });
}
