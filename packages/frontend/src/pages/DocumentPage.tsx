import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell, Crumbs } from '../components/AppShell';
import { NoAccess } from '../components/NoAccess';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { MarkdownView } from '../components/MarkdownView';
import { VersionHistoryPanel } from '../components/VersionHistoryPanel';
import { ShareDialog } from '../components/ShareDialog';
import { TagEditor } from '../components/TagEditor';
import { Presence, type PresenceUser } from '../components/Presence';
import { EmptyState, SkeletonRows } from '../components/EmptyState';
import { Icon } from '../components/ui/Icon';
import { Menu } from '../components/ui/Menu';
import { useToast } from '../components/ui/Toast';
import { useConfirm } from '../components/ui/ConfirmProvider';
import { useRegisterWorkspace } from '../components/CommandPalette';
import { api, ApiError, errorMessage, type DocumentFull, type Role, type Workspace } from '../lib/api';
import { downloadAuthed } from '../lib/download';
import { connectRealtime, type RealtimeConnection, type RealtimeStatus } from '../lib/realtimeSocket';
import { useAuth } from '../context/AuthContext';
import { useFavorites } from '../lib/favorites';
import { useIsNarrow } from '../lib/useMediaQuery';
import { usePageMeta } from '../lib/seo';
import { timeAgo } from '../lib/time';

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
type Patch = Partial<{ title: string; contentMd: string; tags: string[] }>;
const RANK: Role[] = ['viewer', 'editor', 'admin', 'owner'];

export function DocumentPage() {
  const { documentId, '*': sub } = useParams<{ documentId: string; '*': string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { email: myEmail } = useAuth();
  const { isFavorite, toggle: toggleFavorite } = useFavorites();
  const narrow = useIsNarrow();

  const [doc, setDoc] = useState<DocumentFull | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [title, setTitle] = useState('');
  const [contentMd, setContentMd] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [rtStatus, setRtStatus] = useState<RealtimeStatus>('connecting');
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [panel, setPanel] = useState<'tags' | null>(null);
  const base = `/documents/${documentId}`;
  const [editingOnMobile, setEditingOnMobile] = useState(false);
  const pending = useRef<Patch>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const rtRef = useRef<RealtimeConnection | null>(null);
  useRegisterWorkspace(doc?.workspace_id);
  usePageMeta(doc ? title || 'Untitled' : undefined, { noindex: true });

  // Role: the API's effective role when present (newer API), else the workspace role.
  const role: Role | undefined = doc?.role ?? workspace?.role;
  const canEdit = !!role && RANK.indexOf(role) >= 1;
  const canDelete = !!workspace?.role && RANK.indexOf(workspace.role) >= 1;
  const editing = canEdit && (!narrow || editingOnMobile);

  const load = useCallback(async () => {
    if (!documentId) return;
    setLoadError(null);
    try {
      const d = await api.getDocument(documentId);
      setDoc(d);
      setTitle(d.title);
      setContentMd(d.content_md);
      setTags(d.tags);
      api.getWorkspace(d.workspace_id).then(setWorkspace).catch(() => setWorkspace(null));
    } catch (e) {
      setLoadError(e instanceof ApiError ? e : new ApiError(0, errorMessage(e)));
    }
  }, [documentId]);
  useEffect(() => {
    setDoc(null);
    load();
  }, [load]);

  const flush = useCallback(async () => {
    if (!documentId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    pending.current = {};
    setSaveState('saving');
    try {
      const saved = await api.updateDocument(documentId, patch);
      setDoc((d) => (d ? { ...d, ...saved, role: d.role } : d));
      setSaveState(Object.keys(pending.current).length ? 'pending' : 'saved');
    } catch (e) {
      // Put the unsaved fields back so the retry sends them.
      pending.current = { ...patch, ...pending.current };
      setSaveState('error');
      toast.show(`Couldn’t save: ${errorMessage(e)}`, { tone: 'error', action: { label: 'Retry', onClick: () => flush() } });
    }
  }, [documentId, toast]);

  function schedule(patch: Patch) {
    pending.current = { ...pending.current, ...patch };
    setSaveState('pending');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 600);
  }

  // Save on the way out (route change), and warn before closing the tab with unsaved typing.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) {
        flush();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      flush();
    };
  }, [flush]);

  // Realtime: presence + live (unpersisted) typing from others. Persistence stays on PATCH.
  useEffect(() => {
    if (!documentId || loadError || !doc) return;
    setPresence([]);
    const rt = connectRealtime(
      'document',
      documentId,
      (msg) => {
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
            if (!pending.current.contentMd) setContentMd(msg.contentMd as string);
            break;
        }
      },
      {
        onStatus: setRtStatus,
        // Edits broadcast while disconnected were missed; reload unless we have our own unsaved typing.
        onReconnect: () => {
          if (Object.keys(pending.current).length) return;
          api
            .getDocument(documentId)
            .then((d) => {
              setTitle(d.title);
              setContentMd(d.content_md);
              setTags(d.tags);
            })
            .catch(() => undefined);
        },
      },
    );
    rtRef.current = rt;
    return () => rt.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, loadError, !!doc]);

  async function deleteDoc() {
    if (!doc) return;
    const ok = await confirm({
      title: `Delete “${title || 'Untitled'}”?`,
      message: 'This deletes the document and its version history for everyone. It can’t be undone.',
      confirmLabel: 'Delete document',
      danger: true,
    });
    if (!ok) return;
    try {
      pending.current = {};
      await api.deleteDocument(doc.id);
      toast.success(`Deleted “${title || 'Untitled'}”`);
      navigate(`/workspaces/${doc.workspace_id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (loadError) {
    if (loadError.status === 403 || loadError.status === 404) return <NoAccess what="document" notFound={loadError.status === 404} />;
    return (
      <AppShell sidebarMode="drawer" title={<strong>Document</strong>}>
        <EmptyState icon="alert" title="This document didn’t load" actions={<button className="btn btn-primary" onClick={load}>Try again</button>}>
          {loadError.message}
        </EmptyState>
      </AppShell>
    );
  }

  const others = presence.filter((u) => u.email !== myEmail);
  const fav = doc ? isFavorite('document', doc.id) : false;
  const statusText =
    saveState === 'saving' || saveState === 'pending' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Not saved' : doc ? `Edited ${timeAgo(doc.updated_at)}` : '';

  return (
    <AppShell
      sidebarMode="drawer"
      workspace={workspace}
      title={
        <Crumbs
          items={[
            { label: workspace?.name ?? (doc ? 'Workspace' : '…'), to: doc ? `/workspaces/${doc.workspace_id}` : undefined },
            { label: title || 'Untitled' },
          ]}
        />
      }
      actions={
        doc && (
          <>
            <Presence users={others} />
            {rtStatus === 'reconnecting' || rtStatus === 'offline' ? (
              <span className="save-status" role="status">
                <Icon name="wifiOff" size={13} /> {rtStatus === 'offline' ? 'Offline' : 'Reconnecting…'}
              </span>
            ) : null}
            {editing && (
              <span className={`save-status hide-mobile ${saveState === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
                {statusText}
              </span>
            )}
            {canEdit && narrow && (
              <button type="button" className="btn" onClick={() => setEditingOnMobile((v) => !v)}>
                <Icon name={editingOnMobile ? 'eye' : 'edit'} /> {editingOnMobile ? 'Done' : 'Edit'}
              </button>
            )}
            <button
              type="button"
              className={`btn btn-ghost btn-icon star ${fav ? 'on' : ''}`}
              aria-pressed={fav}
              aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
              onClick={() => toggleFavorite({ kind: 'document', id: doc.id, name: title || 'Untitled' }).catch((e) => toast.error(errorMessage(e)))}
            >
              <Icon name="star" />
            </button>
            <button type="button" className="btn hide-mobile" onClick={() => navigate(`${base}/share`)}>
              <Icon name="share" /> Share
            </button>
            <Menu
              className="btn btn-ghost btn-icon"
              label="Document actions"
              trigger={<Icon name="more" />}
              items={[
                { label: 'Share', icon: 'share', onSelect: () => navigate(`${base}/share`) },
                { label: 'Version history', icon: 'history', onSelect: () => navigate(`${base}/history`) },
                ...(canEdit ? [{ label: 'Edit tags', icon: 'tag' as const, onSelect: () => setPanel('tags') }] : []),
                { label: 'Export as markdown', icon: 'download', onSelect: () => downloadAuthed(api.exportUrl('documents', doc.id), `${title || 'Untitled'}.md`).catch((e) => toast.error(errorMessage(e))) },
                {
                  label: 'Copy link',
                  icon: 'link',
                  onSelect: () => navigator.clipboard.writeText(window.location.href).then(() => toast.success('Link copied. People need access to open it.')),
                },
                ...(canDelete ? ['separator' as const, { label: 'Delete document', icon: 'trash' as const, danger: true, onSelect: deleteDoc }] : []),
              ]}
            />
          </>
        )
      }
    >
      {!sub && (
      <div className="doc-wrap">
        {!doc ? (
          <>
            <span className="skeleton" style={{ height: 44, width: '60%', marginBottom: 16 }} />
            <SkeletonRows rows={6} height={22} />
          </>
        ) : (
          <>
            {editing ? (
              <input
                className="doc-title"
                aria-label="Document title"
                value={title}
                placeholder="Untitled"
                maxLength={300}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (e.target.value.trim()) schedule({ title: e.target.value });
                }}
              />
            ) : (
              <h1 className="doc-title">{title || 'Untitled'}</h1>
            )}
            <div className="doc-meta">
              {!canEdit && <span className="tag tag-neutral">View only</span>}
              {tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
              {canEdit && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPanel('tags')}>
                  <Icon name="tag" size={13} /> {tags.length ? 'Edit tags' : 'Add tags'}
                </button>
              )}
              {!editing && <span>· Edited {timeAgo(doc.updated_at)}</span>}
            </div>
            {editing ? (
              <MarkdownEditor
                value={contentMd}
                workspaceId={doc.workspace_id}
                onSaveNow={() => flush().then(() => toast.success('Saved'))}
                onCreateDiagram={async (name) => (await api.createDiagram(doc.workspace_id, name, doc.folder_id)).id}
                onChange={(md) => {
                  setContentMd(md);
                  schedule({ contentMd: md });
                  rtRef.current?.send('document.update', { contentMd: md });
                }}
              />
            ) : contentMd.trim() ? (
              <MarkdownView markdown={contentMd} />
            ) : (
              <EmptyState icon="doc" title="This document is empty" compact>
                {canEdit ? 'Tap Edit to start writing.' : 'Nothing has been written here yet.'}
              </EmptyState>
            )}
          </>
        )}
      </div>
      )}

      {doc && (
        <>
          <VersionHistoryPanel
            open={sub === 'history'}
            onClose={() => navigate(base, { replace: true })}
            backTo={base}
            resourceKind="document"
            resourceId={doc.id}
            current={{ contentMd, title }}
            canRestore={canEdit}
            onRestored={() => {
              pending.current = {};
              load();
            }}
          />
          <ShareDialog
            open={sub === 'share'}
            backTo={base}
            kind="document"
            id={doc.id}
            name={title || 'Untitled'}
            workspaceName={workspace?.name}
            canManage={canEdit}
          />
          {panel === 'tags' && (
            <TagEditor
              open
              name={title || 'Untitled'}
              tags={tags}
              suggestions={[]}
              onClose={() => setPanel(null)}
              onSave={(next) => {
                setPanel(null);
                setTags(next);
                schedule({ tags: next });
              }}
            />
          )}
        </>
      )}
    </AppShell>
  );
}
