import type pg from 'pg';
import { query } from '../db.js';

export type ResourceType = 'document' | 'diagram';

/** Snapshots the current full state of a document/diagram before it's overwritten. */
export async function recordVersion(
  resourceType: ResourceType,
  resourceId: string,
  snapshot: Record<string, unknown>,
  createdBy: string,
  client?: pg.PoolClient,
): Promise<void> {
  const sql = 'insert into versions (resource_id, resource_type, snapshot, created_by) values ($1, $2, $3, $4)';
  const params = [resourceId, resourceType, JSON.stringify(snapshot), createdBy];
  if (client) {
    await client.query(sql, params);
  } else {
    await query(sql, params);
  }
}
