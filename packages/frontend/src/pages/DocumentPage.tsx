import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type DocumentFull } from '../lib/api';
import { downloadAuthed } from '../lib/download';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { VersionHistoryPanel } from '../components/VersionHistoryPanel';

export function DocumentPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<DocumentFull | null>(null);
  const [title, setTitle] = useState('');
  const [contentMd, setContentMd] = useState('');
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showHistory, setShowHistory] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!documentId) return;
    api.getDocument(documentId).then((d) => {
      setDoc(d);
      setTitle(d.title);
      setContentMd(d.content_md);
    });
  }, [documentId]);

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

  if (!doc) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div className="app-shell">
      <div className="main-area">
        <div className="topbar">
          <div className="breadcrumb">
            <Link to={`/workspaces/${doc.workspace_id}`}>← Workspace</Link>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
