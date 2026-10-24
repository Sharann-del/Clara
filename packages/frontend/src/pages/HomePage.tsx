import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { EmptyState, SkeletonRows } from '../components/EmptyState';
import { ItemList, type ListItem } from '../components/ItemList';
import { Icon } from '../components/ui/Icon';
import { useToast } from '../components/ui/Toast';
import { useConfirm } from '../components/ui/ConfirmProvider';
import { useAppCommands } from '../components/CommandPalette';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage, isMissingRoute, type SearchResult, type SharedItem } from '../lib/api';
import { ensureOnboarded } from '../lib/onboarding';
import { useWorkspaces } from '../lib/useWorkspaces';
import { usePageMeta } from '../lib/seo';
import { MOD } from '../lib/shortcuts';
import { useFavorites } from '../lib/favorites';
import { useAuthSub } from '../lib/useAuthSub';

/** Recently updated items across every workspace; falls back to per-workspace lists on older APIs. */
async function loadRecent(): Promise<SearchResult[]> {
  try {
    return await api.search('', 12);
  } catch (err) {
    if (!isMissingRoute(err)) throw err;
    const workspaces = await api.listWorkspaces();
    const rows = (
      await Promise.all(
        workspaces.map(async (w) => {
          const [docs, diagrams] = await Promise.all([api.listDocuments(w.id), api.listDiagrams(w.id)]);
          return [
            ...docs.map((d) => ({ ...d, kind: 'document' as const, name: d.title, workspace_name: w.name })),
            ...diagrams.map((d) => ({ ...d, kind: 'diagram' as const, workspace_name: w.name })),
          ] as unknown as SearchResult[];
        }),
      )
    ).flat();
    return rows.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')).slice(0, 12);
  }
}

export function HomePage() {
  usePageMeta('Home', { noindex: true });
  const { email } = useAuth();
  const toast = useToast();
  const { prompt } = useConfirm();
  const { openPalette } = useAppCommands();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { workspaces, refresh, error: wsError } = useWorkspaces();
  const [recent, setRecent] = useState<SearchResult[] | null>(null);
  const [shared, setShared] = useState<SharedItem[]>([]);
  const [setupError, setSetupError] = useState<string | null>(null);
  const { favorites, toggle: toggleFavorite, isFavorite } = useFavorites();
  const onboarding = useRef(false);
  const [settingUp, setSettingUp] = useState(false);
  const mySub = useAuthSub();

  // First run, right after sign-up: a starter workspace with sample content, then the tour. Not
  // automatic otherwise, so deleting your last workspace doesn't quietly make a new one.
  /** Asks the server for first-run setup; it only ever creates content once per account. */
  const runSetup = useCallback(
    (force: boolean) => {
      onboarding.current = true;
      setSetupError(null);
      setSettingUp(true);
      ensureOnboarded(mySub ?? 'anon')
        .then(async (r) => {
          const list = await refresh();
          if (r.created || (force && r.workspaceId && list.length)) navigate(`/workspaces/${r.workspaceId}?tour=1`, { replace: true });
        })
        .catch((e) => setSetupError(errorMessage(e)))
        .finally(() => setSettingUp(false));
    },
    [navigate, refresh, mySub],
  );
  // Right after sign-up, or the first time an account with no workspaces arrives here.
  useEffect(() => {
    if (onboarding.current || workspaces === null) return;
    if (params.get('welcome') || workspaces.length === 0) runSetup(false);
  }, [workspaces, params, runSetup]);

  useEffect(() => {
    loadRecent().then(setRecent).catch(() => setRecent([]));
    api.sharedWithMe().then(setShared).catch(() => setShared([]));
  }, []);

  async function newWorkspace() {
    const name = await prompt({ title: 'New workspace', label: 'Name', placeholder: 'e.g. Platform team', confirmLabel: 'Create workspace' });
    if (!name) return;
    try {
      const ws = await api.createWorkspace(name);
      await refresh();
      navigate(`/workspaces/${ws.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function quickCreate(kind: 'document' | 'diagram') {
    const wsId = workspaces?.[0]?.id;
    if (!wsId) return;
    try {
      if (kind === 'document') navigate(`/documents/${(await api.createDocument(wsId, 'Untitled')).id}`);
      else navigate(`/diagrams/${(await api.createDiagram(wsId, 'Untitled diagram')).id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const toItem = (r: SearchResult): ListItem => ({
    kind: r.kind,
    id: r.id,
    name: r.name,
    tags: r.tags,
    updatedAt: r.updated_at,
    context: r.workspace_name,
  });
  const star = (it: ListItem) =>
    it.kind === 'folder' ? null : (
      <button
        type="button"
        className={`btn btn-ghost btn-icon btn-sm star ${isFavorite(it.kind, it.id) ? 'on' : ''}`}
        aria-pressed={isFavorite(it.kind, it.id)}
        aria-label={isFavorite(it.kind, it.id) ? `Remove ${it.name} from favorites` : `Add ${it.name} to favorites`}
        onClick={() => toggleFavorite({ kind: it.kind as 'document' | 'diagram', id: it.id, name: it.name }).catch((e) => toast.error(errorMessage(e)))}
      >
        <Icon name="star" />
      </button>
    );

  const first = email?.split('@')[0];


  return (
    <AppShell title={<strong>Home</strong>}>
      <div className="content-narrow" style={{ maxWidth: 960 }}>
        <div className="page-head">
          <div>
            <h1>{first ? `Welcome back, ${first}` : 'Welcome back'}</h1>
            <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
              Press <kbd>{MOD}</kbd> <kbd>K</kbd> to jump to anything.
            </p>
          </div>
          <button type="button" className="btn" onClick={openPalette}>
            <Icon name="search" /> Search
          </button>
        </div>

        {setupError && (
          <div className="panel error-panel" role="alert" style={{ marginBottom: 16 }}>
            <strong>Your first workspace couldn't be set up.</strong> {setupError}{' '}
            <button type="button" className="btn btn-sm" onClick={() => runSetup(true)}>
              Try again
            </button>
          </div>
        )}
        {settingUp && (
          <div className="panel" role="status" style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="spinner" aria-hidden="true" /> Setting up your workspace with a welcome doc and a sample diagram…
          </div>
        )}

        <div className="quick-actions">
          <button type="button" className="quick-action" onClick={() => quickCreate('document')} disabled={!workspaces?.length}>
            <Icon name="doc" size={20} />
            <span>
              <strong>New document</strong>
              <span className="muted">Markdown, with diagrams inline</span>
            </span>
          </button>
          <button type="button" className="quick-action" onClick={() => quickCreate('diagram')} disabled={!workspaces?.length}>
            <Icon name="diagram" size={20} />
            <span>
              <strong>New diagram</strong>
              <span className="muted">Draw it or write it as code</span>
            </span>
          </button>
          <Link to="/editor" className="quick-action">
            <Icon name="code" size={20} />
            <span>
              <strong>Playground</strong>
              <span className="muted">Scratch space, shareable links</span>
            </span>
          </Link>
        </div>

        <section aria-labelledby="fav-title">
          <div className="section-head">
            <h2 id="fav-title">Favorites</h2>
          </div>
          {favorites.length === 0 ? (
            <EmptyState icon="star" title="No favorites yet" compact>
              Star a document or diagram to keep it here.
            </EmptyState>
          ) : (
            <ItemList items={favorites.map((f) => ({ kind: f.kind, id: f.id, name: f.name }))} trailing={star} />
          )}
        </section>

        <section aria-labelledby="recent-title">
          <div className="section-head">
            <h2 id="recent-title">Recently updated</h2>
          </div>
          {recent === null ? (
            <SkeletonRows rows={4} />
          ) : recent.length === 0 ? (
            <EmptyState icon="clock" title="Nothing here yet" compact>
              Documents and diagrams you and your team edit show up here.
            </EmptyState>
          ) : (
            <ItemList items={recent.map(toItem)} trailing={star} />
          )}
        </section>

        {shared.length > 0 && (
          <section aria-labelledby="shared-title">
            <div className="section-head">
              <h2 id="shared-title">Shared with you</h2>
            </div>
            <ItemList
              items={shared.map((r) => ({ kind: r.kind, id: r.id, name: r.name, tags: r.tags, updatedAt: r.updated_at, context: `${r.workspace_name} · ${r.role}` }))}
              trailing={star}
            />
          </section>
        )}

        <section aria-labelledby="ws-title">
          <div className="section-head">
            <h2 id="ws-title">Workspaces</h2>
            <button type="button" className="btn btn-sm" onClick={newWorkspace}>
              <Icon name="plus" /> New workspace
            </button>
          </div>
          {wsError && <div className="error-text">{wsError}</div>}
          {workspaces === null ? (
            <SkeletonRows rows={2} height={56} />
          ) : workspaces.length === 0 && !settingUp ? (
            <EmptyState
              icon="layers"
              title="You’re not in any workspace"
              actions={
                <button type="button" className="btn btn-primary" onClick={newWorkspace}>
                  <Icon name="plus" /> Create a workspace
                </button>
              }
            >
              Workspaces hold your documents and diagrams. Create one, or ask a teammate to invite you to theirs.
            </EmptyState>
          ) : (
            <div className="ws-grid">
              {workspaces.map((w) => (
                <Link key={w.id} to={`/workspaces/${w.id}`} className="ws-card">
                  <span className="ws-avatar" aria-hidden="true">
                    {w.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="ws-name">{w.name}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
