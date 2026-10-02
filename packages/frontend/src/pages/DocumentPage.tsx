import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { NoAccess } from '../components/NoAccess';
import { api, ApiError, type DocumentFull } from '../lib/api';
import { downloadAuthed } from '../lib/download';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { VersionHistoryPanel } from '../components/VersionHistoryPanel';
import { connectRealtime, type RealtimeConnection } from '../lib/realtimeSocket';
import { useAuth } from '../context/AuthContext';

interface PresenceUser {
  userId: string;
  email?: string;
}

export function DocumentPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const { email: myEmail } = useAuth();
  const [doc, setDoc] = useState<DocumentFull | null>(null);
  const [title, setTitle] = useState('');
  const [contentMd, setContentMd] = useState('');
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showHistory, setShowHistory] = useState(false);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rtRef = useRef<RealtimeConnection | null>(null);

  useEffect(() => {
    if (!documentId) return;
    setLoadError(null);
    api
      .getDocument(documentId)
      .then((d) => {
        setDoc(d);
        setTitle(d.title);
        setContentMd(d.content_md);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e : new ApiError(0, String(e?.message ?? e))));
  }, [documentId]);

  // Realtime: presence + live (unpersisted) content broadcast between open
  // tabs — see routes/documents.ts for why persistence stays on the REST
  // PATCH path instead of going through the socket.
  useEffect(() => {
    if (!documentId || loadError) return;
    setPresence([]);
    const rt = connectRealtime('document', documentId, (msg) => {
      switch (msg.type) {
        case 'presence.snapshot':
          setPresence(msg.users as PresenceUser[]);
          break;
        case 'presence.joined':
          setPresence((prev) => [...prev.filter((u) => u.userId !== msg.userId), { userId: msg.userId as string, email: msg.email as string | undefined }]);
          break;
        case 'presence.left':
          setPresence((prev) => prev.filter((u) => u.userId !== msg.userId));
          break;
        case 'document.updated':
          setContentMd(msg.contentMd as string);
          break;
      }
    });
    rtRef.current = rt;
    return () => rt.close();
  }, [documentId, loadError]);

  function scheduleSave(patch: Partial<{ title: string; contentMd: string }>) {
    if (!documentId) return;
    setSaving('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await api.updateDocument(documentId, patch);
      setSaving('saved');
    }, 600);
  }

  async function deleteDoc() {
    if (!documentId || !doc) return;
    if (!confirm(`Delete "${doc.title}"?`)) return;
    await api.deleteDocument(documentId);
    navigate(`/workspaces/${doc.workspace_id}`);
  }

  if (loadError) {
    if (loadError.status === 403 || loadError.status === 404)
      return <NoAccess what="document" notFound={loadError.status === 404} />;
    return <div style={{ padding: 24 }}>Failed to load document: {loadError.message}</div>;
  }
  if (!doc) return <div style={{ padding: 24 }}>Loading…</div>;

  const others = presence.filter((u) => u.email !== myEmail);

  return (
    <div className="app-shell">
      <div className="main-area">
        <div className="topbar">
          <div className="breadcrumb">
            <Link to={`/workspaces/${doc.workspace_id}`}>← Workspace</Link>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {others.length > 0 && (
              <div style={{ display: 'flex', gap: 4 }} title={others.map((u) => u.email).join(', ')}>
                {others.map((u) => (
                  <span
                    key={u.userId}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: '#dbeafe',
                      color: '#1d4ed8',
                      fontSize: 10,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 600,
                    }}
                  >
                    {(u.email ?? u.userId).slice(0, 2).toUpperCase()}
                  </span>
                ))}
              </div>
            )}
            <span className="muted">{saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : ''}</span>
            <button className="btn" onClick={() => setShowHistory((s) => !s)}>
              History
            </button>
            <button
              className="btn"
              onClick={() => downloadAuthed(api.exportUrl('documents', doc.id), `${doc.title}.md`)}
            >
              Export .md
            </button>
            <button className="btn btn-danger" onClick={deleteDoc}>
              Delete
            </button>
          </div>
        </div>
        <div className="content" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input
              className="input"
              style={{ fontSize: 20, fontWeight: 600, width: '100%', marginBottom: 12, border: 'none' }}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                scheduleSave({ title: e.target.value });
              }}
            />
            <MarkdownEditor
              value={contentMd}
              onChange={(md) => {
                setContentMd(md);
                scheduleSave({ contentMd: md });
                rtRef.current?.send('document.update', { contentMd: md });
              }}
            />
          </div>
          {showHistory && (
            <VersionHistoryPanel
              resourceKind="document"
              resourceId={doc.id}
              onRestored={() => api.getDocument(doc.id).then((d) => {
                setDoc(d);
                setTitle(d.title);
                setContentMd(d.content_md);
              })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
