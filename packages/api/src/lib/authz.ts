import { query } from '../db.js';

export type Role = 'viewer' | 'editor' | 'admin' | 'owner';
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export function roleAtLeast(role: Role | undefined, min: Role): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[min];
}

/** A user's role in a workspace via workspace_members, or undefined if not a member. */
export async function workspaceRole(userId: string, workspaceId: string): Promise<Role | undefined> {
  const { rows } = await query<{ role: Role }>(
    'select role from workspace_members where workspace_id = $1 and user_id = $2',
    [workspaceId, userId],
  );
  return rows[0]?.role;
}

/**
 * Effective role on a specific resource: the workspace role, upgraded by any
 * direct per-resource permissions grant (PRD `permissions` table), whichever
 * is higher.
 */
export async function effectiveResourceRole(
  userId: string,
  workspaceId: string,
  resourceType: 'workspace' | 'folder' | 'document' | 'diagram',
  resourceId: string,
): Promise<Role | undefined> {
  const wsRole = await workspaceRole(userId, workspaceId);

  const { rows } = await query<{ role: Role }>(
    'select role from permissions where resource_type = $1 and resource_id = $2 and user_id = $3',
    [resourceType, resourceId, userId],
  );
  const directRole = rows[0]?.role;

  if (!wsRole && !directRole) return undefined;
  if (!wsRole) return directRole;
  if (!directRole) return wsRole;
  return RANK[wsRole] >= RANK[directRole] ? wsRole : directRole;
}

// statusCode is what app.ts's error handler turns these into, so services can throw
// them and every caller (REST routes, MCP tools, change review) responds consistently.
export class ForbiddenError extends Error {
  statusCode = 403;
}
export class NotFoundError extends Error {
  statusCode = 404;
}
export class ConflictError extends Error {
  statusCode = 409;
}
export class BadRequestError extends Error {
  statusCode = 400;
}

/** Throws ForbiddenError unless `userId` holds at least `min` in the workspace. */
export async function assertWorkspaceRole(userId: string, workspaceId: string, min: Role): Promise<Role> {
  const role = await workspaceRole(userId, workspaceId);
  if (!role) throw new ForbiddenError('Not a member of this workspace');
  if (!roleAtLeast(role, min)) {
    throw new ForbiddenError(`${min[0].toUpperCase()}${min.slice(1)} role required`);
  }
  return role;
}

export type ResourceKind = 'document' | 'diagram';

/**
 * Throws unless the user's *effective* role on this document/diagram (workspace role, or a
 * direct per-item grant from the permissions table, whichever is higher) is at least `min`.
 * This is the single check REST, MCP and the realtime socket share for item access.
 */
export async function assertResourceRole(
  userId: string,
  kind: ResourceKind,
  row: { id: string; workspace_id: string },
  min: Role,
): Promise<Role> {
  const role = await effectiveResourceRole(userId, row.workspace_id, kind, row.id);
  if (!role) throw new ForbiddenError(`You don't have access to this ${kind}`);
  if (!roleAtLeast(role, min)) throw new ForbiddenError(`${min[0].toUpperCase()}${min.slice(1)} role required`);
  return role;
}

/** A folder used as a destination must exist in the same workspace (folders are global rows). */
export async function assertFolderInWorkspace(folderId: string | null | undefined, workspaceId: string) {
  if (!folderId) return;
  const { rows } = await query<{ workspace_id: string }>('select workspace_id from folders where id = $1', [folderId]);
  if (!rows[0] || rows[0].workspace_id !== workspaceId) throw new BadRequestError('Folder not found in this workspace');
}
