import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { config } from './config.js';
import { requireAuth } from './auth.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { folderRoutes } from './routes/folders.js';
import { documentRoutes } from './routes/documents.js';
import { diagramRoutes } from './routes/diagrams.js';
import { versionRoutes } from './routes/versions.js';
import { stateRoutes } from './routes/states.js';
import { tokenRoutes } from './routes/tokens.js';
import { pendingChangeRoutes } from './routes/pending-changes.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { searchRoutes } from './routes/search.js';
import { sharingRoutes } from './routes/sharing.js';
import { favoriteRoutes } from './routes/favorites.js';
import { publicRoutes } from './routes/public.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof ZodError) {
      reply.code(400).send({ error: 'Invalid request body', issues: err.issues });
      return;
    }
    app.log.error(err);
    reply.code(err.statusCode ?? 500).send({ error: err.message || 'Internal error' });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  // Unauthenticated, read-only share links. Registered outside the auth hook on purpose.
  await app.register(publicRoutes);

  app.register(async (protectedApp) => {
    protectedApp.addHook('preHandler', requireAuth);

    protectedApp.get('/me', async (req) => ({ sub: req.user!.sub, email: req.user!.email }));

    await protectedApp.register(workspaceRoutes);
    await protectedApp.register(folderRoutes);
    await protectedApp.register(documentRoutes);
    await protectedApp.register(diagramRoutes);
    await protectedApp.register(stateRoutes);
    await protectedApp.register(versionRoutes);
    await protectedApp.register(tokenRoutes);
    await protectedApp.register(pendingChangeRoutes);
    await protectedApp.register(onboardingRoutes);
    await protectedApp.register(searchRoutes);
    await protectedApp.register(sharingRoutes);
    await protectedApp.register(favoriteRoutes);
  });

  return app;
}
