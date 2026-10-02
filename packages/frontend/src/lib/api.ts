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

async function authHeader(): Promise<Record<string, string>> {
  const session = await getCurrentSession();
  if (!session?.isValid()) return {};
  return { Authorization: `Bearer ${session.getIdToken().getJwtToken()}` };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = {
    ...(await authHeader()),
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
  role?: string;
}

export interface Member {
  user_id: string;
  email?: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
}

export interface Folder {
  id: string;
  workspace_id: string;
  parent_folder_id: string | null;
  name: string;
}

export interface DocumentSummary {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  title: string;
  tags: string[];
}

export interface DocumentFull extends DocumentSummary {
  content_md: string;
  created_by: string;
  updated_by: string;
  updated_at: string;
}

export interface DiagramSummary {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  parent_diagram_id: string | null;
  name: string;
  tags: string[];
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
  elements: Array<
    DiagramElement & { id: string; diagram_id: string; z_index: number; linked_diagram_id: string | null }
  >;
}

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

export const api = {
  me: () => request<{ sub: string; email?: string }>('/me'),

  listWorkspaces: () => request<Workspace[]>('/workspaces'),
  createWorkspace: (name: string) =>
    request<Workspace>('/workspaces', { method: 'POST', body: JSON.stringify({ name }) }),
  getWorkspace: (id: string) => request<Workspace>(`/workspaces/${id}`),
  listMembers: (workspaceId: string) => request<Member[]>(`/workspaces/${workspaceId}/members`),
  inviteMember: (workspaceId: string, email: string, role: 'editor' | 'viewer') =>
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

  listDocuments: (workspaceId: string, folderId?: string) =>
    request<DocumentSummary[]>(
      `/workspaces/${workspaceId}/documents${folderId ? `?folderId=${folderId}` : ''}`,
    ),
  createDocument: (workspaceId: string, title: string, folderId?: string | null) =>
    request<DocumentFull>(`/workspaces/${workspaceId}/documents`, {
      method: 'POST',
      body: JSON.stringify({ title, folderId }),
    }),
  getDocument: (id: string) => request<DocumentFull>(`/documents/${id}`),
  updateDocument: (id: string, patch: Partial<{ title: string; contentMd: string; tags: string[] }>) =>
    request<DocumentFull>(`/documents/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteDocument: (id: string) => request<void>(`/documents/${id}`, { method: 'DELETE' }),
  documentVersions: (id: string) => request<VersionSummary[]>(`/documents/${id}/versions`),
  restoreDocumentVersion: (id: string, versionId: string) =>
    request<DocumentFull>(`/documents/${id}/versions/${versionId}/restore`, { method: 'POST' }),

  listDiagrams: (workspaceId: string, folderId?: string) =>
    request<DiagramSummary[]>(
      `/workspaces/${workspaceId}/diagrams${folderId ? `?folderId=${folderId}` : ''}`,
    ),
  createDiagram: (workspaceId: string, name: string, folderId?: string | null, parentDiagramId?: string | null) =>
    request<DiagramSummary>(`/workspaces/${workspaceId}/diagrams`, {
      method: 'POST',
      body: JSON.stringify({ name, folderId, parentDiagramId }),
    }),
  getDiagram: (id: string) => request<DiagramFull>(`/diagrams/${id}`),
  updateDiagram: (id: string, patch: Partial<{ name: string; tags: string[] }>) =>
    request<DiagramSummary>(`/diagrams/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteDiagram: (id: string) => request<void>(`/diagrams/${id}`, { method: 'DELETE' }),
  saveDiagramElements: (id: string, elements: DiagramElement[]) =>
    request<DiagramFull['elements']>(`/diagrams/${id}/elements`, {
      method: 'PUT',
      body: JSON.stringify({ elements }),
    }),
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

  exportUrl: (kind: 'documents' | 'diagrams', id: string, format?: string) =>
    `${BASE_URL}/${kind}/${id}/export${format ? `?format=${format}` : ''}`,
};

export { ApiError };
