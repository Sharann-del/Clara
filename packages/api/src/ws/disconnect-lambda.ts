import { deleteConnection, getConnection } from './dynamo.js';
import { broadcastToRoom } from './broadcast.js';

interface WsDisconnectEvent {
  requestContext: { connectionId: string };
}

export async function handler(event: WsDisconnectEvent) {
  const connectionId = event.requestContext.connectionId;
  const conn = await getConnection(connectionId);
  await deleteConnection(connectionId);
  if (conn) {
    await broadcastToRoom(conn.room, { type: 'presence.left', userId: conn.userId }, connectionId);
  }
  return { statusCode: 200 };
}
