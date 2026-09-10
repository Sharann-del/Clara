import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Workspace } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export function WorkspacesPage() {
  const { email, signOut } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .listWorkspaces()
      .then(setWorkspaces)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function createWorkspace() {
    if (!name.trim()) return;
    const ws = await api.createWorkspace(name.trim());
    setName('');
    setWorkspaces((prev) => [ws, ...prev]);
  }

  return (
    <div className="app-shell">
      <div className="main-area">
        <div className="topbar">
          <strong>Clara</strong>
          <div className="muted">
            {email} · <button className="btn" onClick={signOut}>Sign out</button>
          </div>
        </div>
        <div className="content" style={{ maxWidth: 640, margin: '0 auto', width: '100%' }}>
          <h2>Your workspaces</h2>
          <div className="editor-toolbar">
            <input
              className="input"
              placeholder="New workspace name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createWorkspace()}
            />
            <button className="btn btn-primary" onClick={createWorkspace}>
              Create workspace
            </button>
          </div>
          {error && <div className="error-text">{error}</div>}
          {loading ? (
            <p className="muted">Loading…</p>
          ) : workspaces.length === 0 ? (
            <p className="muted">No workspaces yet — create one above.</p>
          ) : (
            workspaces.map((ws) => (
              <div className="list-item" key={ws.id}>
                <Link to={`/workspaces/${ws.id}`}>{ws.name}</Link>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
