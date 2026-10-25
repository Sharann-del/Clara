import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SiteHeader } from '../components/site/SiteLayout';
import { DiagramViewer } from '../components/DiagramViewer';
import { CodeEditor } from '../components/CodeEditor';
import { Menu } from '../components/ui/Menu';
import { Icon } from '../components/ui/Icon';
import { Dialog } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../context/AuthContext';
import { api, type Workspace } from '../lib/api';
import { compileDiagram, describeCompile } from '../lib/diagramFromCode';
import { DEFAULT_EXAMPLE, EXAMPLES } from '../lib/examples';
import { exportDiagram, type ExportFormat } from '../lib/exporters';
import { decodeState, detectFormat, encodeState, type CodeFormat, type PlaygroundState } from '../lib/share';
import { usePageMeta } from '../lib/seo';
import { MOD } from '../lib/shortcuts';
import { useDebounced } from '../lib/useDebounced';

const DRAFT_KEY = 'clara.playground.draft';
const PENDING_SAVE_KEY = 'clara.playground.pendingSave';
const SPLIT_KEY = 'clara.playground.split';

function readJson<T>(storage: Storage, key: string): T | undefined {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}
function writeJson(storage: Storage, key: string, value: unknown) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: drafts are a convenience
  }
}

/**
 * Public, no-login playground (like mermaid.live): code on the left, live diagram on the right.
 * State lives in the URL hash (shareable) and a local draft; nothing goes to the server until
 * "Save to Clara".
 */
export function PlaygroundPage() {
  usePageMeta('Playground', {
    description:
      'Write Clara DSL or Mermaid and see the diagram as you type. Export SVG, PNG or PDF and share a link. No sign-in needed.',
  });
  const toast = useToast();
  const { idToken } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [state, setState] = useState<PlaygroundState | null>(null);
  const [name, setName] = useState('Untitled diagram');
  const [mobileTab, setMobileTab] = useState<'code' | 'diagram'>('code');
  const [split, setSplit] = useState<number>(() => readJson<number>(localStorage, SPLIT_KEY) ?? 0.42);
  const [saveOpen, setSaveOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Initial state: URL hash > pending save (returning from sign-in) > local draft > default example.
  useEffect(() => {
    let live = true;
    (async () => {
      const fromHash = await decodeState(window.location.hash);
      const pending = readJson<PlaygroundState & { name?: string }>(sessionStorage, PENDING_SAVE_KEY);
      const initial = fromHash ??
        (params.get('save') ? pending : undefined) ??
        readJson<PlaygroundState>(localStorage, DRAFT_KEY) ?? {
          code: DEFAULT_EXAMPLE.code,
          format: DEFAULT_EXAMPLE.format,
        };
      if (!live) return;
      setState(initial);
      if (params.get('save') && pending?.name) setName(pending.name);
    })();
    const onHash = async () => {
      const s = await decodeState(window.location.hash);
      if (s) setState(s);
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      live = false;
      window.removeEventListener('hashchange', onHash);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back from sign-in with a pending "Save to Clara": open the dialog.
  useEffect(() => {
    if (params.get('save') && idToken && state) {
      setSaveOpen(true);
      params.delete('save');
      setParams(params, { replace: true });
    }
  }, [params, idToken, state, setParams]);

  const debounced = useDebounced(state, 120);
  const compiled = useMemo(() => (debounced ? compileDiagram(debounced.code, debounced.format) : null), [debounced]);

  // Keep the hash and the local draft in sync (replaceState: no history entry per keystroke).
  const persisted = useDebounced(state, 500);
  useEffect(() => {
    if (!persisted) return;
    writeJson(localStorage, DRAFT_KEY, persisted);
    let live = true;
    encodeState(persisted).then((hash) => {
      if (live)
        window.history.replaceState(
          window.history.state,
          '',
          `${window.location.pathname}${window.location.search}#${hash}`,
        );
    });
    return () => {
      live = false;
    };
  }, [persisted]);

  // Pasting Mermaid into the DSL editor (or DSL into Mermaid) switches the format. Only for
  // paste-sized changes, so typing never overrides a format the user picked.
  const setCode = (code: string) =>
    setState((s) => {
      const prev = s?.format ?? 'clara';
      if (!s || Math.abs(code.length - s.code.length) < 15) return { code, format: prev };
      if (detectFormat(code) === 'mermaid') return { code, format: 'mermaid' };
      if (prev === 'mermaid' && /^\s*(node|edge|group|direction)\s/m.test(code)) return { code, format: 'clara' };
      return { code, format: prev };
    });

  const copyLink = useCallback(async () => {
    if (!state) return;
    const url = `${window.location.origin}/editor#${await encodeState(state)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Share link copied. Anyone with it sees this diagram; nothing is stored on a server.');
    } catch {
      // Clipboard blocked: the same link is already in the address bar (kept in sync as you type).
      toast.show('Couldn’t copy automatically. The share link is in your address bar; copy it from there.', {
        durationMs: 8000,
      });
    }
  }, [state, toast]);

  async function runExport(format: ExportFormat) {
    if (!compiled) return;
    try {
      await exportDiagram(compiled.elements, name, format);
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    }
  }

  function startSave() {
    if (!state) return;
    if (idToken) {
      setSaveOpen(true);
      return;
    }
    writeJson(sessionStorage, PENDING_SAVE_KEY, { ...state, name });
    navigate(`/signin?next=${encodeURIComponent('/editor?save=1')}&reason=save`);
  }

  // Draggable divider between code and diagram (desktop).
  function onDividerDown(e: React.PointerEvent) {
    const host = bodyRef.current;
    if (!host) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = host.getBoundingClientRect();
    const move = (ev: PointerEvent) => setSplit(Math.min(0.75, Math.max(0.2, (ev.clientX - rect.left) / rect.width)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setSplit((s) => (writeJson(localStorage, SPLIT_KEY, s), s));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  if (!state) return <div className="playground" aria-busy="true" />;

  return (
    <div className="playground">
      <a href="#playground-code" className="skip-link">
        Skip to the code editor
      </a>
      <SiteHeader />
      <div className="pg-toolbar" role="toolbar" aria-label="Playground">
        <label className="sr-only" htmlFor="pg-name">
          Diagram name
        </label>
        <input
          id="pg-name"
          className="input pg-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />
        <div className="segmented" role="radiogroup" aria-label="Code format">
          {(['clara', 'mermaid'] as CodeFormat[]).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={state.format === f}
              className={state.format === f ? 'on' : ''}
              onClick={() => setState({ ...state, format: f })}
            >
              {f === 'clara' ? 'Clara DSL' : 'Mermaid'}
            </button>
          ))}
        </div>
        <Menu
          align="left"
          trigger={
            <>
              <Icon name="layers" /> <span className="hide-mobile">Examples</span> <Icon name="chevronDown" size={14} />
            </>
          }
          label="Examples"
          items={EXAMPLES.map((ex) => ({
            label: `${ex.title} — ${ex.blurb}`,
            onSelect: () => {
              setState({ code: ex.code, format: ex.format });
              setName(ex.title);
            },
          }))}
        />
        <span className="spacer" />
        <button type="button" className="btn" onClick={copyLink} title={`Copy share link (${MOD}+S)`}>
          <Icon name="link" /> <span className="hide-mobile">Share</span>
        </button>
        <Menu
          trigger={
            <>
              <Icon name="download" /> <span className="hide-mobile">Export</span>
            </>
          }
          label="Export"
          items={[
            { label: 'SVG image', onSelect: () => runExport('svg') },
            { label: 'PNG image (2×)', onSelect: () => runExport('png') },
            { label: 'PDF document', onSelect: () => runExport('pdf') },
            'separator',
            { label: 'Mermaid source (.mmd)', onSelect: () => runExport('mermaid') },
          ]}
        />
        <button type="button" className="btn btn-primary" onClick={startSave}>
          <Icon name="upload" /> Save to Clara
        </button>
      </div>

      <div className="pg-tabs show-mobile" role="tablist" aria-label="View">
        {(['code', 'diagram'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={mobileTab === t}
            className={`tab-btn ${mobileTab === t ? 'active' : ''}`}
            onClick={() => setMobileTab(t)}
          >
            {t === 'code' ? 'Code' : 'Diagram'}
          </button>
        ))}
      </div>

      <div
        className="pg-body"
        ref={bodyRef}
        style={{ ['--split' as string]: `${split * 100}%` }}
        data-mobile-tab={mobileTab}
      >
        <section className="pg-code" aria-label="Code">
          <CodeEditor
            id="playground-code"
            label={`Diagram code (${state.format === 'clara' ? 'Clara DSL' : 'Mermaid'})`}
            value={state.code}
            onChange={setCode}
            issues={compiled?.issues}
            onKey={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                copyLink();
                return true;
              }
            }}
          />
          <div
            id="playground-code-status"
            className={`code-status ${compiled?.issues.length ? 'error' : ''}`}
            aria-live="polite"
          >
            {compiled ? describeCompile(compiled) : ' '}
          </div>
          <div className="pg-help">
            {state.format === 'clara' ? (
              <>
                <code>node id "Label"</code> · <code>edge a -&gt; b "label"</code> ·{' '}
                <code>group g "Name" {'{ a b }'}</code> · <code>direction LR</code> ·{' '}
                <Link to="/docs/dsl">Reference</Link>
              </>
            ) : (
              <>
                <code>flowchart LR</code> · <code>A[Box] --&gt;|label| B(Round)</code> ·{' '}
                <Link to="/docs/mermaid">What's supported</Link>
              </>
            )}
          </div>
        </section>
        <div
          className="pg-divider hide-mobile"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panes"
          aria-valuenow={Math.round(split * 100)}
          aria-valuemin={20}
          aria-valuemax={75}
          tabIndex={0}
          onPointerDown={onDividerDown}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setSplit((s) => Math.max(0.2, s - 0.03));
            if (e.key === 'ArrowRight') setSplit((s) => Math.min(0.75, s + 0.03));
          }}
        />
        <section className="pg-stage" aria-label="Diagram preview">
          <DiagramViewer
            elements={compiled?.elements ?? []}
            emptyText={
              state.code.trim()
                ? 'No nodes yet. Check the messages under the editor.'
                : 'Start typing, or pick an example.'
            }
          />
        </section>
      </div>

      {saveOpen && (
        <SaveToClaraDialog
          state={state}
          name={name}
          onClose={() => setSaveOpen(false)}
          elements={compiled?.elements ?? []}
        />
      )}
    </div>
  );
}

function SaveToClaraDialog({
  state,
  name: initialName,
  elements,
  onClose,
}: {
  state: PlaygroundState;
  name: string;
  elements: ReturnType<typeof compileDiagram>['elements'];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listWorkspaces()
      .then((ws) => {
        setWorkspaces(ws);
        setWorkspaceId(ws[0]?.id ?? '');
      })
      .catch((e) => setError(e.message));
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      let wsId = workspaceId;
      if (!wsId) wsId = (await api.createWorkspace('My workspace')).id;
      const diagram = await api.createDiagram(wsId, name.trim() || 'Untitled diagram');
      await api.saveDiagramElements(diagram.id, elements);
      await api.setDiagramSource(diagram.id, state.code, state.format);
      try {
        sessionStorage.removeItem(PENDING_SAVE_KEY);
      } catch {
        // ignore
      }
      toast.success(`Saved "${diagram.name}" to Clara`);
      navigate(`/diagrams/${diagram.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Save to Clara"
      description="Creates an editable diagram in a workspace, with this code kept as its source."
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || workspaces === null}>
            {busy ? 'Saving…' : 'Save diagram'}
          </button>
        </>
      }
    >
      <label className="field">
        Name
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={300} />
      </label>
      <label className="field">
        Workspace
        {workspaces === null ? (
          <span className="skeleton" style={{ height: 32 }} />
        ) : workspaces.length === 0 ? (
          <span className="field-hint">You don't have a workspace yet; Clara will create "My workspace".</span>
        ) : (
          <select className="input" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
      </label>
      {error && (
        <div className="error-text" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}
