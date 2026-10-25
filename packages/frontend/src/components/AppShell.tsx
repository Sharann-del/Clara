import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from './site/Logo';
import { Icon } from './ui/Icon';
import { Menu } from './ui/Menu';
import { useAppCommands } from './CommandPalette';
import { useConfirm } from './ui/ConfirmProvider';
import { useToast } from './ui/Toast';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage, type Workspace } from '../lib/api';
import { clearWorkspaceCache, useWorkspaces } from '../lib/useWorkspaces';
import { MOD } from '../lib/shortcuts';

interface Props {
  /** The workspace in context (sidebar shows its sections). */
  workspace?: (Workspace & { role?: string }) | null;
  /** Extra sidebar content under the workspace nav, e.g. the folder tree. */
  sidebar?: ReactNode;
  /** Left side of the top bar (breadcrumb / title). */
  title?: ReactNode;
  /** Right side of the top bar. */
  actions?: ReactNode;
  /** 'hidden' keeps the sidebar as a drawer on every screen size (editor pages). */
  sidebarMode?: 'docked' | 'drawer';
  /** Pending-change count for the badge (editors and up). */
  pendingCount?: number;
  /** Sidebar links to the workspace's review queue and member list. */
  showPending?: boolean;
  showMembers?: boolean;
  /** Full-bleed content (canvas) instead of the padded scroll area. */
  bleed?: boolean;
  children: ReactNode;
}

export function AppShell({ workspace, sidebar, title, actions, sidebarMode = 'docked', pendingCount, showPending, showMembers, bleed, children }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setDrawerOpen(false), [location.pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className={`shell shell-${sidebarMode} ${drawerOpen ? 'drawer-open' : ''}`}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="shell-sidebar" id="app-sidebar" aria-label="Navigation">
        <Sidebar workspace={workspace} pendingCount={pendingCount} showPending={showPending} showMembers={showMembers} onClose={() => setDrawerOpen(false)}>
          {sidebar}
        </Sidebar>
      </aside>
      {drawerOpen && <div className="shell-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
      <div className="shell-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="btn btn-ghost btn-icon shell-menu-btn"
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              aria-controls="app-sidebar"
              onClick={() => setDrawerOpen(true)}
            >
              <Icon name="menu" size={18} />
            </button>
            {title}
          </div>
          <div className="topbar-actions">{actions}</div>
        </header>
        <main id="main" tabIndex={-1} className={bleed ? 'shell-content bleed' : 'shell-content content'}>
          {children}
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  workspace,
  pendingCount,
  showPending,
  showMembers,
  onClose,
  children,
}: {
  workspace?: (Workspace & { role?: string }) | null;
  pendingCount?: number;
  showPending?: boolean;
  showMembers?: boolean;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { email, signOut } = useAuth();
  const { openPalette } = useAppCommands();
  const { workspaces, refresh } = useWorkspaces();
  const { prompt } = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();

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

  return (
    <div className="sidebar-inner">
      <div className="sidebar-top">
        <Logo to="/" />
        <button type="button" className="btn btn-ghost btn-icon btn-sm shell-close-btn" aria-label="Close navigation" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>

      <Menu
        align="left"
        className="ws-switcher"
        label={`Workspace: ${workspace?.name ?? 'none selected'}. Switch workspace`}
        trigger={
          <>
            <span className="ws-avatar" aria-hidden="true">
              {(workspace?.name ?? 'C').slice(0, 1).toUpperCase()}
            </span>
            <span className="ws-name">{workspace?.name ?? 'All workspaces'}</span>
            <Icon name="chevronDown" size={14} />
          </>
        }
        items={[
          ...(workspaces ?? []).map((w) => ({ label: w.name, icon: 'folder' as const, onSelect: () => navigate(`/workspaces/${w.id}`) })),
          'separator' as const,
          { label: 'New workspace…', icon: 'plus', onSelect: newWorkspace },
        ]}
      />

      <button type="button" className="sidebar-search" onClick={openPalette} data-tour="search">
        <Icon name="search" />
        <span>Search</span>
        <kbd>{MOD}K</kbd>
      </button>

      <nav className="sidebar-nav" aria-label="Main">
        <NavLink to="/app" end className="folder-tree-item">
          <Icon name="home" /> Home
        </NavLink>
        {workspace && (
          <>
            <NavLink to={`/workspaces/${workspace.id}`} end className="folder-tree-item">
              <Icon name="layers" /> All items
            </NavLink>
            {showPending && (
              <NavLink to={`/workspaces/${workspace.id}/pending`} className="folder-tree-item" data-tour="pending">
                <Icon name="review" /> Pending changes
                {!!pendingCount && (
                  <span className="badge" style={{ marginLeft: 'auto' }} aria-label={`${pendingCount} waiting`}>
                    {pendingCount}
                  </span>
                )}
              </NavLink>
            )}
            {showMembers && (
              <NavLink to={`/workspaces/${workspace.id}/members`} className="folder-tree-item">
                <Icon name="users" /> Members
              </NavLink>
            )}
          </>
        )}
      </nav>

      <div className="sidebar-extra">{children}</div>

      <div className="sidebar-foot">
        <Link to="/settings" className="folder-tree-item">
          <Icon name="settings" /> Settings
        </Link>
        <div className="sidebar-user">
          <Menu
            align="left"
            className="btn btn-ghost sidebar-user-btn"
            label="Account"
            trigger={
              <>
                <span className="ws-avatar user" aria-hidden="true">
                  {(email ?? '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="ws-name">{email}</span>
              </>
            }
            items={[
              { label: 'Profile and settings', icon: 'settings', onSelect: () => navigate('/settings') },
              { label: 'Access tokens', icon: 'key', onSelect: () => navigate('/settings/tokens') },
              { label: 'Keyboard shortcuts', icon: 'keyboard', hint: '?', onSelect: () => navigate('/shortcuts') },
              { label: 'Documentation', icon: 'book', onSelect: () => navigate('/docs') },
              'separator',
              {
                label: 'Sign out',
                icon: 'logout',
                onSelect: () => {
                  clearWorkspaceCache();
                  signOut();
                  navigate('/');
                },
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

/** Breadcrumb used in the top bar. Last item is the current page. */
export function Crumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      {items.map((c, i) => (
        <span key={`${c.label}-${i}`} style={{ display: 'contents' }}>
          {i > 0 && <Icon name="chevronRight" size={13} aria-hidden="true" />}
          {c.to && i < items.length - 1 ? (
            <Link to={c.to}>{c.label}</Link>
          ) : (
            <span className="current" aria-current="page">
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
