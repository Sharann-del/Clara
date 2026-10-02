import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type DiagramSummary, type DocumentSummary, type Folder, type Workspace } from '../lib/api';
import { MembersPanel } from '../components/MembersPanel';
import { FolderTree } from '../components/FolderTree';
import { useAuth } from '../context/AuthContext';

export function WorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { email, signOut } = useAuth();
  const navigate = useNavigate();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    api.getWorkspace(workspaceId).then(setWorkspace).catch((e) => setError(e.message));
    api.listFolders(workspaceId).then(setFolders).catch((e) => setError(e.message));
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    api
      .listDocuments(workspaceId, selectedFolderId ?? undefined)
      .then(setDocuments)
      .catch((e) => setError(e.message));
    api
      .listDiagrams(workspaceId, selectedFolderId ?? undefined)
      .then(setDiagrams)
      .catch((e) => setError(e.message));
  }, [workspaceId, selectedFolderId]);

  async function createFolder() {
    if (!workspaceId || !newFolderName.trim()) return;
    const folder = await api.createFolder(workspaceId, newFolderName.trim(), selectedFolderId);
    setFolders((prev) => [...prev, folder]);
    setNewFolderName('');
  }

  async function createDocument() {
    if (!workspaceId) return;
    const doc = await api.createDocument(workspaceId, 'Untitled', selectedFolderId);
    navigate(`/documents/${doc.id}`);
  }

  async function createDiagram() {
    if (!workspaceId) return;
    const diagram = await api.createDiagram(workspaceId, 'Untitled diagram', selectedFolderId);
    navigate(`/diagrams/${diagram.id}`);
  }

  if (!workspaceId) return null;

  return (
    <div className="app-shell">
      <div className="sidebar">
        <div className="sidebar-header">
          <Link to="/" style={{ fontSize: 13, textDecoration: 'none', color: 'inherit' }}>
            ← {workspace?.name ?? 'Workspace'}
          </Link>
        </div>
        <div style={{ padding: 8, flex: 1 }}>
          <FolderTree folders={folders} selectedFolderId={selectedFolderId} onSelect={setSelectedFolderId} />
        </div>
        <div style={{ padding: 8, borderTop: '1px solid var(--border)', display: 'flex', gap: 6 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="New folder"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createFolder()}
          />
          <button className="btn" onClick={createFolder}>
            +
          </button>
        </div>
      </div>

      <div className="main-area">
        <div className="topbar">
          <strong>{workspace?.name}</strong>
          <div className="muted">
            {email} · <button className="btn" onClick={signOut}>Sign out</button>
          </div>
        </div>
        <div className="content">
          {error && <div className="error-text">{error}</div>}

          <div className="editor-toolbar">
            <button className="btn btn-primary" onClick={createDocument}>
              + Document
            </button>
            <button className="btn btn-primary" onClick={createDiagram}>
              + Diagram
            </button>
            <button className="btn" onClick={() => setShowMembers((s) => !s)}>
              Members
            </button>
          </div>

          {showMembers && (
            <MembersPanel
              workspaceId={workspaceId}
              canInvite={workspace?.role === 'owner' || workspace?.role === 'admin'}
            />
          )}

          <h3>Documents</h3>
          {documents.length === 0 && <p className="muted">No documents here yet.</p>}
          {documents.map((doc) => (
            <div className="list-item" key={doc.id}>
              <Link to={`/documents/${doc.id}`}>📄 {doc.title}</Link>
              <span>
                {doc.tags.map((t) => (
                  <span className="tag" key={t}>
                    {t}
                  </span>
                ))}
              </span>
            </div>
          ))}

          <h3>Diagrams</h3>
          {diagrams.length === 0 && <p className="muted">No diagrams here yet.</p>}
          {diagrams.map((d) => (
            <div className="list-item" key={d.id}>
              <Link to={`/diagrams/${d.id}`}>🧩 {d.name}</Link>
              <span>
                {d.tags.map((t) => (
                  <span className="tag" key={t}>
                    {t}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
