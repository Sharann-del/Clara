import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { config } from '../config.js';
import { query } from '../db.js';
import { effectiveResourceRole } from '../lib/authz.js';
import { putConnection, roomKey } from './dynamo.js';
import { broadcastToRoom } from './broadcast.js';

const verifier = CognitoJwtVerifier.create({
  userPoolId: config.userPoolId,
  tokenUse: 'id',
  clientId: config.userPoolClientId,
});

interface WsConnectEvent {
  requestContext: { connectionId: string };
  queryStringParameters?: Record<string, string> | null;
}

/**
 * $connect — the client opens one WebSocket per open document/diagram, e.g.
 * `wss://.../prod?token=<idToken>&resourceType=diagram&resourceId=<uuid>`.
 * Custom headers aren't available on the WS handshake from a browser, so auth
 * travels as a query param instead of an Authorization header.
 *
 * Deliberately does NOT postToConnection back to `connectionId` (itself):
 * API Gateway hasn't finished registering a connection with the Management
 * API while its own $connect invocation is still running, so a self-post
 * here reliably throws GoneException — which, worse, our broadcast helper
 * treats as "stale connection, prune it," silently deleting the row this
 * same handler just wrote. The client requests its presence snapshot
 * itself once open (see message-lambda.ts's `presence.sync`), by which
 * point the connection is fully registered and postToConnection works.
 */
export async function handler(event: WsConnectEvent) {
  const connectionId = event.requestContext.connectionId;
  const qs = event.queryStringParameters ?? {};
  const token = qs.token;
  const resourceType = qs.resourceType;
  const resourceId = qs.resourceId;

  if (!token || !resourceId || (resourceType !== 'document' && resourceType !== 'diagram')) {
    return { statusCode: 400, body: 'Missing token/resourceType/resourceId' };
  }

  let sub: string;
  let email: string | undefined;
  try {
    const payload = await verifier.verify(token);
    sub = payload.sub;
    email = typeof payload.email === 'string' ? payload.email : undefined;
  } catch {
    return { statusCode: 401, body: 'Invalid token' };
  }

  const table = resourceType === 'document' ? 'documents' : 'diagrams';
  const { rows } = await query<{ workspace_id: string }>(
    `select workspace_id from ${table} where id = $1`,
    [resourceId],
  );
  const resource = rows[0];
  if (!resource) return { statusCode: 404, body: 'Resource not found' };

  const role = await effectiveResourceRole(sub, resource.workspace_id, resourceType, resourceId);
  if (!role) return { statusCode: 403, body: 'Forbidden' };

  const room = roomKey(resourceType, resourceId);

  await putConnection({
    connectionId,
    room,
    resourceType,
    resourceId,
    workspaceId: resource.workspace_id,
    userId: sub,
    email,
    role,
    connectedAt: Date.now(),
    expiresAt: Math.floor(Date.now() / 1000) + 4 * 60 * 60,
  });

  await broadcastToRoom(room, { type: 'presence.joined', userId: sub, email }, connectionId);

  return { statusCode: 200 };
}
