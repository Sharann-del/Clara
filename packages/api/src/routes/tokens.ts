import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createToken, DEFAULT_TOKEN_TTL_DAYS, listTokens, revokeToken } from '../lib/tokens.js';

// Personal access tokens for the MCP server. Managed with a normal Cognito
// session (see app.ts) — a token can't be used to mint or list tokens.
export async function tokenRoutes(app: FastifyInstance) {
  app.get('/tokens', async (req) => listTokens(req.user!.sub));

  app.post('/tokens', async (req, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(100),
        // null = never expires.
        expiresInDays: z.number().int().min(1).max(365).nullable().default(DEFAULT_TOKEN_TTL_DAYS),
      })
      .parse(req.body ?? {});
    reply.code(201).send(await createToken(req.user!.sub, body.name, body.expiresInDays));
  });

  app.delete('/tokens/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await revokeToken(req.user!.sub, id);
    reply.code(204).send();
  });
}
