import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { config } from '../config.js';
import { deleteConnection, listRoomConnections } from './dynamo.js';

let client: ApiGatewayManagementApiClient | undefined;
function managementClient(): ApiGatewayManagementApiClient {
  if (!client) {
    client = new ApiGatewayManagementApiClient({ region: config.awsRegion, endpoint: config.wsManagementEndpoint });
  }
  return client;
}

/** Posts to one connection; silently prunes it from DynamoDB if API Gateway reports it gone. */
export async function postTo(connectionId: string, payload: unknown): Promise<void> {
  try {
    await managementClient().send(
      new PostToConnectionCommand({ ConnectionId: connectionId, Data: JSON.stringify(payload) }),
    );
  } catch (err) {
    if (err instanceof GoneException) {
      await deleteConnection(connectionId);
      return;
    }
    throw err;
  }
}

export async function broadcastToRoom(room: string, payload: unknown, excludeConnectionId?: string): Promise<void> {
  const conns = await listRoomConnections(room);
  await Promise.all(
    conns.filter((c) => c.connectionId !== excludeConnectionId).map((c) => postTo(c.connectionId, payload)),
  );
}
