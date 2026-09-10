import type { FastifyReply, FastifyRequest } from 'fastify';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { config } from './config.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { sub: string; email?: string };
  }
}

const verifier = CognitoJwtVerifier.create({
  userPoolId: config.userPoolId,
  tokenUse: 'id',
  clientId: config.userPoolClientId,
});

/** Fastify preHandler: verifies the Cognito ID token, attaches req.user, 401s otherwise. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!token) {
    reply.code(401).send({ error: 'Missing bearer token' });
    return;
  }

  try {
    const payload = await verifier.verify(token);
    req.user = { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
  } catch {
    reply.code(401).send({ error: 'Invalid or expired token' });
  }
}
