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

export class ForbiddenError extends Error {}
export class NotFoundError extends Error {}
