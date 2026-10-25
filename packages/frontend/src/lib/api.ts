import { normalizeElement } from '@clara/shared/elements';
import { getCurrentSession } from './cognito';

const BASE_URL = import.meta.env.VITE_API_URL;

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * True when the API doesn't have this route at all (Fastify's "Route X not found"), i.e. the
 * frontend is newer than the deployed backend. Callers use it to fall back gracefully.
 */
export function isMissingRoute(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404 && /^Route .+ not found$/.test(err.message);
}

/** Message suitable for a toast: network failures get a plain-language explanation. */
export function errorMessage(err: unknown): string {
  if (err instanceof TypeError && /fetch|network/i.test(err.message))
    return 'Can’t reach Clara. Check your connection and try again.';
  return (err as Error)?.message || 'Something went wrong';
}

async function authHeader(): Promise<Record<string, string>> {
  const session = await getCurrentSession();
  if (!session?.isValid()) return {};
  return { Authorization: `Bearer ${session.getIdToken().getJwtToken()}` };
}

async function request<T>(path: string, options: RequestInit = {}, auth = true): Promise<T> {
  const headers = {
    ...(auth ? await authHeader() : {}),
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers ?? {}),
  };
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface Workspace {
  id: string;
  name: string;
  created_at: string;
  role?: Role;
}

export interface Member {
  user_id: string;
  email?: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  created_at?: string;
}

export interface Folder {
  id: string;
  workspace_id: string;
  parent_folder_id: string | null;
  name: string;
}

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

export interface DocumentSummary {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  title: string;
  tags: string[];
  updated_at?: string;
}

export interface DocumentFull extends DocumentSummary {
  content_md: string;
  created_by: string;
  updated_by: string;
  updated_at: string;
  /** Caller's effective role (workspace or direct share). Absent from older APIs. */
  role?: Role;
}

export interface DiagramSummary {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  parent_diagram_id: string | null;
  name: string;
  tags: string[];
  updated_at?: string;
}

export interface DiagramElement {
  id?: string;
  type: 'rect' | 'ellipse' | 'text' | 'connector' | 'group';
  geometry: Record<string, unknown>;
  style: Record<string, unknown>;
  zIndex: number;
  linkedDiagramId?: string | null;
  parentGroupId?: string | null;
}

export interface DiagramFull extends DiagramSummary {
  elements: Array<DiagramElement & { id: string }>;
  role?: Role;
}

// The server returns diagram_elements rows (linked_diagram_id, z_index, …) and the WebSocket
// broadcasts them too. The canvas works in camelCase, so every element is normalized on the
// way in — otherwise a drill-down link stored in the column is invisible to it.
export { normalizeElement };

export interface ElementOverride {
  hidden?: boolean;
  geometry?: Record<string, unknown>;
  style?: Record<string, unknown>;
}

export interface DiagramState {
  id: string;
  diagram_id: string;
  name: string;
  order_index: number;
  element_overrides: Record<string, ElementOverride>;
}

export interface VersionSummary {
  id: string;
  created_at: string;
  created_by: string;
}

export interface Grant {
  user_id: string;
  email?: string;
  role: 'viewer' | 'editor';
  created_at: string;
  /** Their workspace role, if they're also a member. */
  workspace_role: Role | null;
}

export interface ShareLink {
  id: string;
  token: string;
  created_at: string;
  created_by: string;
}

export interface VersionFull extends VersionSummary {
  snapshot: Record<string, any>;
}

export interface SharedItem {
  kind: 'document' | 'diagram';
  id: string;
  name: string;
  tags: string[];
  updated_at: string;
  role: 'viewer' | 'editor';
  workspace_name: string;
}

export interface PublicDiagram {
  id: string;
  name: string;
  updated_at: string;
  elements: Record<string, unknown>[];
  states: DiagramState[];
}

export type PublicResource =
  | {
      kind: 'document';
      document: { id: string; title: string; content_md: string; tags: string[]; updated_at: string };
    }
  | { kind: 'diagram'; diagram: PublicDiagram };

export interface SearchResult {
  kind: 'document' | 'diagram';
  id: string;
  name: string;
  tags: string[];
  workspace_id: string;
  workspace_name: string;
  folder_id: string | null;
  updated_at: string;
}

export interface OnboardingResult {
  created: boolean;
  /** Null when the account was set up before and has since left or deleted every workspace. */
  workspaceId: string | null;
  documentId?: string;
  diagramId?: string;
}

export interface PersonalAccessToken {
  id: string;
  name: string;
  token_prefix: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface DocumentFields {
  title: string;
  contentMd: string;
  tags: string[];
}

export interface DiagramFields {
  name: string;
  tags: string[];
  elements: DiagramElement[];
}

export interface PendingChange {
  id: string;
  workspace_id: string;
  resource_type: 'document' | 'diagram';
  resource_id: string | null;
  operation: 'create' | 'update';
  /** `proposed` holds only the fields the change touches; `base` is the resource as proposed against (updates only). */
  diff_payload: { proposed: Record<string, any>; base?: Record<string, any> };
  status: 'pending' | 'accepted' | 'rejected';
  proposed_by: string;
  summary: string;
  created_at: string;
  reviewed_at: string | null;
  /** Live resource right now (pending updates only) — what the diff is shown against. */
  current?: DocumentFields | DiagramFields | null;
  /** The resource changed since this was proposed. */
  stale: boolean;
  resource_name: string | null;
}

export const api = {
  me: () => request<{ sub: string; email?: string }>('/me'),
  listFavorites: () => request<{ kind: 'document' | 'diagram'; id: string; name: string }[]>('/favorites'),
  addFavorite: (kind: 'document' | 'diagram', id: string) =>
    request<void>(`/favorites/${kind}/${id}`, { method: 'PUT' }),
  removeFavorite: (kind: 'document' | 'diagram', id: string) =>
    request<void>(`/favorites/${kind}/${id}`, { method: 'DELETE' }),
  onboard: () => request<OnboardingResult>('/onboarding', { method: 'POST' }),
  search: (q: string, limit = 20) => request<SearchResult[]>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  listWorkspaces: () => request<Workspace[]>('/workspaces'),
  createWorkspace: (name: string) =>
    request<Workspace>('/workspaces', { method: 'POST', body: JSON.stringify({ name }) }),
  getWorkspace: (id: string) => request<Workspace>(`/workspaces/${id}`),
  renameWorkspace: (id: string, name: string) =>
    request<Workspace>(`/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteWorkspace: (id: string) => request<void>(`/workspaces/${id}`, { method: 'DELETE' }),
  setMemberRole: (workspaceId: string, userId: string, role: Role) =>
    request<Member>(`/workspaces/${workspaceId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  removeMember: (workspaceId: string, userId: string) =>
    request<void>(`/workspaces/${workspaceId}/members/${userId}`, { method: 'DELETE' }),
  listMembers: (workspaceId: string) => request<Member[]>(`/workspaces/${workspaceId}/members`),
  inviteMember: (workspaceId: string, email: string, role: 'admin' | 'editor' | 'viewer') =>
    request<{ userId: string; role: string }>(`/workspaces/${workspaceId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),

  listFolders: (workspaceId: string) => request<Folder[]>(`/workspaces/${workspaceId}/folders`),
  createFolder: (workspaceId: string, name: string, parentFolderId?: string | null) =>
    request<Folder>(`/workspaces/${workspaceId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ name, parentFolderId }),
    }),

  renameFolder: (id: string, name: string) =>
    request<Folder>(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  moveFolder: (id: string, parentFolderId: string | null) =>
    request<Folder>(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ parentFolderId }) }),
  deleteFolder: (id: string) => request<void>(`/folders/${id}`, { method: 'DELETE' }),

  listDocuments: (workspaceId: string, folderId?: string) =>
    request<DocumentSummary[]>(`/workspaces/${workspaceId}/documents${folderId ? `?folderId=${folderId}` : ''}`),
  createDocument: (workspaceId: string, title: string, folderId?: string | null) =>
    request<DocumentFull>(`/workspaces/${workspaceId}/documents`, {
      method: 'POST',
      body: JSON.stringify({ title, folderId }),
    }),
  getDocument: (id: string) => request<DocumentFull>(`/documents/${id}`),
  updateDocument: (
    id: string,
    patch: Partial<{ title: string; contentMd: string; tags: string[]; folderId: string | null }>,
  ) => request<DocumentFull>(`/documents/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteDocument: (id: string) => request<void>(`/documents/${id}`, { method: 'DELETE' }),
  documentVersions: (id: string) => request<VersionSummary[]>(`/documents/${id}/versions`),
  restoreDocumentVersion: (id: string, versionId: string) =>
    request<DocumentFull>(`/documents/${id}/versions/${versionId}/restore`, { method: 'POST' }),

  listDiagrams: (workspaceId: string, folderId?: string) =>
    request<DiagramSummary[]>(`/workspaces/${workspaceId}/diagrams${folderId ? `?folderId=${folderId}` : ''}`),
  createDiagram: (workspaceId: string, name: string, folderId?: string | null, parentDiagramId?: string | null) =>
    request<DiagramSummary>(`/workspaces/${workspaceId}/diagrams`, {
      method: 'POST',
      body: JSON.stringify({ name, folderId, parentDiagramId }),
    }),
  getDiagram: async (id: string): Promise<DiagramFull> => {
    const d = await request<Omit<DiagramFull, 'elements'> & { elements: Record<string, unknown>[] }>(`/diagrams/${id}`);
    return { ...d, elements: d.elements.map(normalizeElement) };
  },
  updateDiagram: (
    id: string,
    patch: Partial<{ name: string; tags: string[]; folderId: string | null; parentDiagramId: string | null }>,
  ) => request<DiagramSummary>(`/diagrams/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteDiagram: (id: string) => request<void>(`/diagrams/${id}`, { method: 'DELETE' }),
  saveDiagramElements: async (id: string, elements: DiagramElement[]): Promise<DiagramFull['elements']> => {
    const saved = await request<Record<string, unknown>[]>(`/diagrams/${id}/elements`, {
      method: 'PUT',
      body: JSON.stringify({ elements }),
    });
    return saved.map(normalizeElement);
  },
  getDiagramChildren: (id: string) => request<{ id: string; name: string }[]>(`/diagrams/${id}/children`),
  getDiagramSource: (id: string) =>
    request<{ diagram_id: string; dsl_text: string; format: string }>(`/diagrams/${id}/source`),
  setDiagramSource: (id: string, dslText: string, format: 'clara' | 'mermaid') =>
    request<{ dsl_text: string; format: string }>(`/diagrams/${id}/source`, {
      method: 'PUT',
      body: JSON.stringify({ dslText, format }),
    }),
  diagramVersions: (id: string) => request<VersionSummary[]>(`/diagrams/${id}/versions`),
  restoreDiagramVersion: (id: string, versionId: string) =>
    request<DiagramSummary>(`/diagrams/${id}/versions/${versionId}/restore`, { method: 'POST' }),

  listStates: (diagramId: string) => request<DiagramState[]>(`/diagrams/${diagramId}/states`),
  createState: (diagramId: string, name: string, copyFromStateId?: string) =>
    request<DiagramState>(`/diagrams/${diagramId}/states`, {
      method: 'POST',
      body: JSON.stringify({ name, copyFromStateId }),
    }),
  renameState: (stateId: string, name: string) =>
    request<DiagramState>(`/diagram-states/${stateId}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteState: (stateId: string) => request<void>(`/diagram-states/${stateId}`, { method: 'DELETE' }),
  reorderStates: (diagramId: string, stateIds: string[]) =>
    request<DiagramState[]>(`/diagrams/${diagramId}/states/order`, {
      method: 'PUT',
      body: JSON.stringify({ stateIds }),
    }),

  getVersion: (kind: 'document' | 'diagram', id: string, versionId: string) =>
    request<VersionFull>(`/${kind}s/${id}/versions/${versionId}`),

  listGrants: (kind: 'document' | 'diagram', id: string) => request<Grant[]>(`/${kind}s/${id}/permissions`),
  grant: (kind: 'document' | 'diagram', id: string, email: string, role: 'viewer' | 'editor') =>
    request<Grant>(`/${kind}s/${id}/permissions`, { method: 'POST', body: JSON.stringify({ email, role }) }),
  changeGrant: (kind: 'document' | 'diagram', id: string, userId: string, role: 'viewer' | 'editor') =>
    request<Grant>(`/${kind}s/${id}/permissions/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  revokeGrant: (kind: 'document' | 'diagram', id: string, userId: string) =>
    request<void>(`/${kind}s/${id}/permissions/${userId}`, { method: 'DELETE' }),
  listShareLinks: (kind: 'document' | 'diagram', id: string) => request<ShareLink[]>(`/${kind}s/${id}/share-links`),
  createShareLink: (kind: 'document' | 'diagram', id: string) =>
    request<ShareLink>(`/${kind}s/${id}/share-links`, { method: 'POST' }),
  revokeShareLink: (linkId: string) => request<void>(`/share-links/${linkId}`, { method: 'DELETE' }),
  sharedWithMe: () => request<SharedItem[]>('/shared-with-me'),
  getPublic: (token: string) => request<PublicResource>(`/public/${encodeURIComponent(token)}`, {}, false),
  getPublicDiagram: (token: string, diagramId: string) =>
    request<PublicDiagram>(`/public/${encodeURIComponent(token)}/diagrams/${diagramId}`, {}, false),

  listTokens: () => request<PersonalAccessToken[]>('/tokens'),
  createToken: (name: string, expiresInDays: number | null) =>
    request<PersonalAccessToken & { token: string }>('/tokens', {
      method: 'POST',
      body: JSON.stringify({ name, expiresInDays }),
    }),
  revokeToken: (id: string) => request<void>(`/tokens/${id}`, { method: 'DELETE' }),

  listPendingChanges: (workspaceId: string, status: PendingChange['status'] = 'pending') =>
    request<PendingChange[]>(`/workspaces/${workspaceId}/pending-changes?status=${status}`),
  countPendingChanges: (workspaceId: string) =>
    request<{ count: number }>(`/workspaces/${workspaceId}/pending-changes/count`),
  acceptPendingChange: (id: string, force = false) =>
    request<PendingChange>(`/pending-changes/${id}/accept`, { method: 'POST', body: JSON.stringify({ force }) }),
  rejectPendingChange: (id: string) => request<PendingChange>(`/pending-changes/${id}/reject`, { method: 'POST' }),

  mcpUrl: `${BASE_URL.replace(/\/$/, '')}/mcp`,

  exportUrl: (kind: 'documents' | 'diagrams', id: string, format?: string) =>
    `${BASE_URL}/${kind}/${id}/export${format ? `?format=${format}` : ''}`,
};

export { ApiError };
