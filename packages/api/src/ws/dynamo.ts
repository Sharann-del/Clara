import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../config.js';
import type { Role } from '../lib/authz.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.awsRegion }));

export interface ConnectionItem {
  connectionId: string;
  room: string;
  resourceType: 'document' | 'diagram';
  resourceId: string;
  workspaceId: string;
  userId: string;
  email?: string;
  role: Role;
  connectedAt: number;
  expiresAt: number;
}

/** Composite room key connections are grouped by, queried via the RoomIndex GSI. */
export function roomKey(resourceType: 'document' | 'diagram', resourceId: string): string {
  return `${resourceType}#${resourceId}`;
}

export async function putConnection(item: ConnectionItem): Promise<void> {
  await ddb.send(new PutCommand({ TableName: config.connectionsTable, Item: item }));
}

export async function getConnection(connectionId: string): Promise<ConnectionItem | undefined> {
  // Strongly consistent: a client can message immediately after connecting,
  // and this must see that connect's write on the very next request.
  const { Item } = await ddb.send(
    new GetCommand({ TableName: config.connectionsTable, Key: { connectionId }, ConsistentRead: true }),
  );
  return Item as ConnectionItem | undefined;
}

export async function deleteConnection(connectionId: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: config.connectionsTable, Key: { connectionId } }));
}

export async function listRoomConnections(room: string): Promise<ConnectionItem[]> {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: config.connectionsTable,
      IndexName: 'RoomIndex',
      KeyConditionExpression: 'room = :room',
      ExpressionAttributeValues: { ':room': room },
    }),
  );
  return (Items ?? []) as ConnectionItem[];
}

/**
 * Live connections for a user or a room, for the $connect limits. Rows whose
 * $disconnect never ran linger until the TTL sweep, so expired ones are
 * filtered out rather than counted.
 */
async function countLive(indexName: 'UserIndex' | 'RoomIndex', key: 'userId' | 'room', value: string): Promise<number> {
  let count = 0;
  let start: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: config.connectionsTable,
        IndexName: indexName,
        KeyConditionExpression: '#k = :v',
        FilterExpression: 'expiresAt > :now',
        ExpressionAttributeNames: { '#k': key },
        ExpressionAttributeValues: { ':v': value, ':now': Math.floor(Date.now() / 1000) },
        Select: 'COUNT',
        ExclusiveStartKey: start,
      }),
    );
    count += page.Count ?? 0;
    start = page.LastEvaluatedKey;
  } while (start);
  return count;
}

export const countUserConnections = (userId: string) => countLive('UserIndex', 'userId', userId);
export const countRoomConnections = (room: string) => countLive('RoomIndex', 'room', room);

export function dedupeUsers(conns: { userId: string; email?: string }[]): { userId: string; email?: string }[] {
  const map = new Map<string, { userId: string; email?: string }>();
  for (const c of conns) map.set(c.userId, { userId: c.userId, email: c.email });
  return [...map.values()];
}
