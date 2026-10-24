import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog } from './ui/Dialog';
import { Icon, type IconName } from './ui/Icon';
import { ShortcutList } from './ShortcutList';
import { useToast } from './ui/Toast';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage, isMissingRoute, type SearchResult, type Workspace } from '../lib/api';
import { MOD } from '../lib/shortcuts';
import { rankMatches } from '../lib/fuzzy';

interface AppCommands {
  openPalette: () => void;
  openShortcuts: () => void;
  /** Pages call this so "New document" etc. know which workspace you're in. */
  setCurrentWorkspace: (id: string | null) => void;
  currentWorkspaceId: string | null;
}

const Ctx = createContext<AppCommands | undefined>(undefined);

export function useAppCommands(): AppCommands {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppCommands must be used within CommandPaletteProvider');
  return ctx;
}

/** Shows the current page's workspace to the palette while mounted. */
export function useRegisterWorkspace(id: string | null | undefined) {
  const { setCurrentWorkspace } = useAppCommands();
  useEffect(() => {
    if (id) setCurrentWorkspace(id);
  }, [id, setCurrentWorkspace]);
}

const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

interface Item {
  id: string;
  group: 'Documents and diagrams' | 'Workspaces' | 'Commands';
  label: string;
  hint?: string;
  icon: IconName;
  tags?: string[];
  run: () => void;
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        // Inside the markdown editor ⌘K stays the palette too; links have their own button.
        e.preventDefault();
        setShortcutsOpen(false);
        setPaletteOpen((o) => !o);
      } else if (e.key === '?' && !isTyping(e.target) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setPaletteOpen(false);
        setShortcutsOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo<AppCommands>(
    () => ({
      openPalette: () => setPaletteOpen(true),
      openShortcuts: () => setShortcutsOpen(true),
      setCurrentWorkspace: setCurrentWorkspaceId,
      currentWorkspaceId,
    }),
    [currentWorkspaceId],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {paletteOpen && (
        <CommandPalette
          workspaceId={currentWorkspaceId}
          onClose={() => setPaletteOpen(false)}
          onShortcuts={() => {
            setPaletteOpen(false);
            setShortcutsOpen(true);
          }}
        />
      )}
      <Dialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title="Keyboard shortcuts" size="lg">
        <ShortcutList headingLevel={3} />
      </Dialog>
    </Ctx.Provider>
  );
}

/** Client-side index for APIs that predate GET /search. Built once per palette session. */
async function buildFallbackIndex(): Promise<SearchResult[]> {
  const workspaces = await api.listWorkspaces();
  const per = await Promise.all(
    workspaces.map(async (w) => {
      const [docs, diagrams] = await Promise.all([api.listDocuments(w.id), api.listDiagrams(w.id)]);
      return [
        ...docs.map((d) => ({ kind: 'document' as const, id: d.id, name: d.title, tags: d.tags, workspace_id: w.id, workspace_name: w.name, folder_id: d.folder_id, updated_at: (d as { updated_at?: string }).updated_at ?? '' })),
        ...diagrams.map((d) => ({ kind: 'diagram' as const, id: d.id, name: d.name, tags: d.tags, workspace_id: w.id, workspace_name: w.name, folder_id: d.folder_id, updated_at: (d as { updated_at?: string }).updated_at ?? '' })),
      ];
    }),
  );
  return per.flat();
}

function CommandPalette({ workspaceId, onClose, onShortcuts }: { workspaceId: string | null; onClose: () => void; onShortcuts: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { setPreference } = useTheme();
  const { signOut } = useAuth();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(0);
  const fallback = useRef<Promise<SearchResult[]> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listWorkspaces().then(setWorkspaces).catch(() => undefined);
  }, []);

  // Search as you type (debounced). Tag search: "#tag" or just the tag text.
  useEffect(() => {
    let live = true;
    setLoading(true);
    const term = q.trim().replace(/^#/, '');
    const t = setTimeout(async () => {
      try {
        let rows: SearchResult[];
        if (fallback.current) {
          rows = rankMatches(await fallback.current, term, (r) => [r.name, ...r.tags]).slice(0, 20);
        } else {
          try {
            rows = await api.search(term, 20);
          } catch (err) {
            if (!isMissingRoute(err)) throw err;
            fallback.current = buildFallbackIndex();
            rows = rankMatches(await fallback.current, term, (r) => [r.name, ...r.tags]).slice(0, 20);
          }
        }
        if (live) setResults(rows);
      } catch (err) {
        if (live) setResults([]);
        console.warn('search failed', errorMessage(err));
      } finally {
        if (live) setLoading(false);
      }
    }, 140);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const go = useCallback(
    (to: string) => {
      onClose();
      navigate(to);
    },
    [navigate, onClose],
  );

  const create = useCallback(
    async (kind: 'document' | 'diagram') => {
      onClose();
      const wsId = workspaceId ?? workspaces[0]?.id;
      if (!wsId) {
        toast.error('Create a workspace first.');
        return;
      }
      try {
        if (kind === 'document') navigate(`/documents/${(await api.createDocument(wsId, 'Untitled')).id}`);
        else navigate(`/diagrams/${(await api.createDiagram(wsId, 'Untitled diagram')).id}`);
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
    [onClose, workspaceId, workspaces, navigate, toast],
  );

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const found: Item[] = results.map((r) => ({
      id: `${r.kind}:${r.id}`,
      group: 'Documents and diagrams',
      label: r.name,
      hint: r.workspace_name,
      icon: r.kind === 'document' ? 'doc' : 'diagram',
      tags: r.tags,
      run: () => go(`/${r.kind}s/${r.id}`),
    }));
    const wsItems: Item[] = workspaces
      .filter((w) => !term || w.name.toLowerCase().includes(term))
      .slice(0, 6)
      .map((w) => ({ id: `ws:${w.id}`, group: 'Workspaces', label: w.name, icon: 'folder', hint: 'Workspace', run: () => go(`/workspaces/${w.id}`) }));
    const commands: Item[] = [
      { id: 'new-doc', group: 'Commands', label: 'New document', icon: 'doc', run: () => create('document') },
      { id: 'new-diagram', group: 'Commands', label: 'New diagram', icon: 'diagram', run: () => create('diagram') },
      { id: 'home', group: 'Commands', label: 'Go to home', icon: 'home', run: () => go('/app') },
      { id: 'playground', group: 'Commands', label: 'Open the playground', icon: 'code', run: () => go('/editor') },
      { id: 'settings', group: 'Commands', label: 'Settings', icon: 'settings', run: () => go('/settings') },
      { id: 'tokens', group: 'Commands', label: 'Access tokens for AI assistants', icon: 'key', run: () => go('/settings/tokens') },
      { id: 'theme-light', group: 'Commands', label: 'Theme: light', icon: 'sun', run: () => (setPreference('light'), onClose()) },
      { id: 'theme-dark', group: 'Commands', label: 'Theme: dark', icon: 'moon', run: () => (setPreference('dark'), onClose()) },
      { id: 'theme-system', group: 'Commands', label: 'Theme: match system', icon: 'monitor', run: () => (setPreference('system'), onClose()) },
      { id: 'shortcuts', group: 'Commands', label: 'Keyboard shortcuts', hint: '?', icon: 'keyboard', run: onShortcuts },
      { id: 'docs', group: 'Commands', label: 'Documentation', icon: 'book', run: () => go('/docs') },
      { id: 'signout', group: 'Commands', label: 'Sign out', icon: 'logout', run: () => (onClose(), signOut(), navigate('/')) },
    ];
    const cmd = term ? rankMatches(commands, term, (c) => [c.label]) : commands.slice(0, 5);
    return [...found, ...wsItems, ...cmd];
  }, [results, workspaces, q, go, create, setPreference, onClose, onShortcuts, signOut, navigate]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[active]?.run();
    }
  }

  let lastGroup = '';
  return (
    <Dialog open onClose={onClose} title="Search and commands" size="md" initialFocusSelector="input" titleHidden>
      <div className="palette" onKeyDown={onKeyDown}>
        <div className="palette-input">
          <Icon name="search" />
          <input
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `palette-${active}` : undefined}
            aria-autocomplete="list"
            aria-label="Search documents, diagrams and commands"
            placeholder="Search by title or #tag, or type a command…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {loading && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} aria-hidden="true" />}
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef} aria-label="Results">
          {items.length === 0 && !loading && <div className="palette-empty">Nothing matches “{q}”. Try another title or tag.</div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {header && (
                  <div className="palette-group" role="presentation">
                    {header}
                  </div>
                )}
                <div
                  id={`palette-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className={`palette-item ${i === active ? 'active' : ''}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => it.run()}
                >
                  <Icon name={it.icon} />
                  <span className="palette-label">{it.label}</span>
                  {it.tags?.slice(0, 3).map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                  {it.hint && <span className="palette-hint">{it.hint}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close
          </span>
          <span>
            <kbd>{MOD}</kbd> <kbd>K</kbd>
          </span>
        </div>
      </div>
    </Dialog>
  );
}
