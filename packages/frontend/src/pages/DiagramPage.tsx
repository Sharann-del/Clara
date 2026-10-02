import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { NoAccess } from '../components/NoAccess';
import { api, ApiError, type DiagramElement, type DiagramFull, type DiagramState, type ElementOverride } from '../lib/api';
import { DiagramCanvas, type RemoteCursor } from '../components/DiagramCanvas';
import { StatesBar } from '../components/StatesBar';
import { PresentMode } from '../components/PresentMode';
import { mergeOverride, planCreate, resolveElements, startStepIndex } from '../lib/states';
import { VersionHistoryPanel } from '../components/VersionHistoryPanel';
import { downloadAuthed } from '../lib/download';
import { layoutToElements, parseClaraDsl, parseMermaid, toMermaid } from '../lib/dsl';
import { connectRealtime, type RealtimeConnection } from '../lib/realtimeSocket';
import { useAuth } from '../context/AuthContext';

type Tab = 'canvas' | 'dsl';

interface Crumb {
  id: string;
  name: string;
}

interface PresenceUser {
  userId: string;
  email?: string;
}

export function DiagramPage() {
  const { diagramId } = useParams<{ diagramId: string }>();
  const navigate = useNavigate();
  const { email: myEmail } = useAuth();

  const [diagram, setDiagram] = useState<DiagramFull | null>(null);
  const [elements, setElements] = useState<DiagramElement[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('canvas');
  const [dslText, setDslText] = useState('');
  const [mermaidText, setMermaidText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<Crumb[]>([]);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [liveOverrides, setLiveOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor>>({});

  const [states, setStates] = useState<DiagramState[]>([]);
  const [activeStateId, setActiveStateId] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);

  const [loadError, setLoadError] = useState<ApiError | null>(null);

  const rtRef = useRef<RealtimeConnection | null>(null);
  const activeStateIdRef = useRef<string | null>(null);
  activeStateIdRef.current = activeStateId;

  const load = useCallback(async () => {
    if (!diagramId) return;
    const d = await api.getDiagram(diagramId);
    setDiagram(d);
    setElements(d.elements.map((e) => ({ ...e })));
    setSelectedIds([]);
    setStates(await api.listStates(diagramId));
    const source = await api.getDiagramSource(diagramId);
    setDslText(source.dsl_text);

    const crumbs: Crumb[] = [{ id: d.id, name: d.name }];
    let parentId = d.parent_diagram_id;
    while (parentId) {
      const parent = await api.getDiagram(parentId);
      crumbs.unshift({ id: parent.id, name: parent.name });
      parentId = parent.parent_diagram_id;
    }
    setBreadcrumb(crumbs);
  }, [diagramId]);

  useEffect(() => {
    setLoadError(null);
    load().catch((e) => setLoadError(e instanceof ApiError ? e : new ApiError(0, String(e?.message ?? e))));
  }, [load]);

  const refreshStates = useCallback(async () => {
    if (!diagramId) return;
    const next = await api.listStates(diagramId);
    setStates(next);
    setActiveStateId((cur) => (cur && !next.some((st) => st.id === cur) ? null : cur));
  }, [diagramId]);

  const applyOverrideLocally = useCallback((stateId: string, elementId: string, override: ElementOverride | null) => {
    setStates((prev) =>
      prev.map((st) => {
        if (st.id !== stateId) return st;
        const next = { ...st.element_overrides };
        if (override && Object.keys(override).length) next[elementId] = override;
        else delete next[elementId];
        return { ...st, element_overrides: next };
      }),
    );
  }, []);

  // Realtime connection — one per diagram viewed, per PRD 4.10 (live cursors,
  // live element updates, presence).
  useEffect(() => {
    if (!diagramId || loadError) return;
    setPresence([]);
    setRemoteCursors({});
    setLiveOverrides({});

    const rt = connectRealtime('diagram', diagramId, (msg) => {
      switch (msg.type) {
        case 'presence.snapshot':
          setPresence(msg.users as PresenceUser[]);
          break;
        case 'presence.joined':
          setPresence((prev) => [...prev.filter((u) => u.userId !== msg.userId), { userId: msg.userId as string, email: msg.email as string | undefined }]);
          break;
        case 'presence.left':
          setPresence((prev) => prev.filter((u) => u.userId !== msg.userId));
          setRemoteCursors((prev) => {
            const next = { ...prev };
            delete next[msg.userId as string];
            return next;
          });
          break;
        case 'cursor':
          setRemoteCursors((prev) => ({
            ...prev,
            [msg.userId as string]: { x: msg.x as number, y: msg.y as number, email: msg.email as string | undefined },
          }));
          break;
        case 'element.moving':
          // Previews only apply to collaborators looking at the same state (null = Base).
          if ((msg.stateId ?? null) !== activeStateIdRef.current) break;
          setLiveOverrides((prev) => ({ ...prev, [msg.id as string]: { x: msg.x as number, y: msg.y as number } }));
          break;
        case 'element.created':
        case 'element.updated': {
          const el = msg.element as DiagramFull['elements'][number];
          setElements((prev) => [...prev.filter((e) => e.id !== el.id), el]);
          setLiveOverrides((prev) => {
            const next = { ...prev };
            delete next[el.id];
            return next;
          });
          break;
        }
        case 'element.deleted':
          setElements((prev) => prev.filter((e) => e.id !== msg.id));
          break;
        case 'diagram.refreshed':
          load();
          break;
        case 'states.refreshed':
          refreshStates();
          break;
        case 'state.override':
          setLiveOverrides((prev) => {
            const next = { ...prev };
            delete next[msg.elementId as string];
            return next;
          });
          applyOverrideLocally(msg.stateId as string, msg.elementId as string, msg.override as ElementOverride | null);
          break;
      }
    });
    rtRef.current = rt;
    return () => rt.close();
  }, [diagramId, load, loadError, refreshStates, applyOverrideLocally]);

  const activeState = states.find((st) => st.id === activeStateId);

  function saveOverride(state: DiagramState, elementId: string, override: ElementOverride | null) {
    applyOverrideLocally(state.id, elementId, override);
    rtRef.current?.send('state.override', { stateId: state.id, elementId, override });
  }

  /** While a state is selected, element edits become overrides on that state instead of changing the base diagram. */
  function overrideEdit(
    id: string,
    patch: { geometry?: Record<string, unknown>; style?: Record<string, unknown>; hidden?: boolean },
  ) {
    const base = elements.find((e) => e.id === id);
    if (!base || !activeState) return;
    saveOverride(activeState, id, mergeOverride(base, activeState.element_overrides[id], patch));
  }

  function handleCreateElement(el: DiagramElement) {
    const { element, override } = planCreate(el, activeStateId);
    setElements((prev) => [...prev, element]);
    rtRef.current?.send('element.create', { element });
    if (override && activeState) saveOverride(activeState, override.elementId, override.value);
  }

  function handleUpdateElement(id: string, patch: { geometry?: Record<string, unknown>; style?: Record<string, unknown> }) {
    if (activeState) return overrideEdit(id, patch);
    setElements((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    rtRef.current?.send('element.update', { id, ...patch });
  }

  function handleMoveLive(id: string, x: number, y: number) {
    rtRef.current?.send('element.moving', { id, x, y, stateId: activeStateId });
  }

  function handleDeleteElements(ids: string[]) {
    // In a state, "delete" just hides the element there; it still exists in the base and other states.
    if (activeState) {
      for (const id of ids) overrideEdit(id, { hidden: true });
      return;
    }
    setElements((prev) => prev.filter((e) => !ids.includes(e.id!)));
    for (const id of ids) rtRef.current?.send('element.delete', { id });
  }

  function handleCursorMove(x: number, y: number) {
    rtRef.current?.send('cursor', { x, y });
  }

  async function addState(name: string, copyFromActive: boolean) {
    if (!diagramId) return;
    const created = await api.createState(diagramId, name, copyFromActive ? activeStateId ?? undefined : undefined);
    setStates((prev) => [...prev, created]);
    setActiveStateId(created.id);
    rtRef.current?.send('states.refresh');
  }

  async function renameState(id: string, name: string) {
    setStates((prev) => prev.map((st) => (st.id === id ? { ...st, name } : st)));
    await api.renameState(id, name);
    rtRef.current?.send('states.refresh');
  }

  async function moveState(id: string, dir: -1 | 1) {
    if (!diagramId) return;
    const i = states.findIndex((st) => st.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= states.length) return;
    const reordered = [...states];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    setStates(reordered);
    setStates(await api.reorderStates(diagramId, reordered.map((st) => st.id)));
    rtRef.current?.send('states.refresh');
  }

  async function deleteState(id: string) {
    await api.deleteState(id);
    setStates((prev) => prev.filter((st) => st.id !== id));
    if (activeStateId === id) setActiveStateId(null);
    rtRef.current?.send('states.refresh');
  }

  async function applyDsl() {
    if (!diagramId) return;
    const graph = parseClaraDsl(dslText);
    const laidOut = layoutToElements(graph);
    const saved = await api.saveDiagramElements(diagramId, laidOut);
    setElements(saved.map((e) => ({ ...e })));
    await api.setDiagramSource(diagramId, dslText, 'clara');
    rtRef.current?.send('diagram.refresh');
  }

  async function importMermaid() {
    if (!diagramId) return;
    const graph = parseMermaid(mermaidText);
    if (graph.nodes.length === 0) {
      alert('No nodes found — check the Mermaid syntax (e.g. `A[Label] --> B[Label]`).');
      return;
    }
    const laidOut = layoutToElements(graph);
    const saved = await api.saveDiagramElements(diagramId, laidOut);
    setElements(saved.map((e) => ({ ...e })));
    rtRef.current?.send('diagram.refresh');
    setTab('canvas');
  }

  function exportMermaid() {
    const text = toMermaid(elements);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${diagram?.name ?? 'diagram'}.mmd`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function linkSelectedToChild() {
    if (!diagramId || selectedIds.length !== 1) return;
    const el = elements.find((e) => e.id === selectedIds[0]);
    if (!el) return;
    const child = await api.createDiagram(diagram!.workspace_id, 'Untitled diagram', diagram!.folder_id, diagramId);
    setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, linkedDiagramId: child.id } : e)));
    rtRef.current?.send('element.update', { id: el.id, linkedDiagramId: child.id });
  }

  async function restoreVersion() {
    if (!diagramId) return;
    await load();
    rtRef.current?.send('diagram.refresh');
  }

  async function deleteDiagram() {
    if (!diagramId || !diagram) return;
    if (!confirm(`Delete "${diagram.name}"?`)) return;
    await api.deleteDiagram(diagramId);
    navigate(`/workspaces/${diagram.workspace_id}`);
  }

  if (loadError) {
    if (loadError.status === 403 || loadError.status === 404)
      return <NoAccess what="diagram" notFound={loadError.status === 404} />;
    return <div style={{ padding: 24 }}>Failed to load diagram: {loadError.message}</div>;
  }
  if (!diagram) return <div style={{ padding: 24 }}>Loading…</div>;

  const displayElements = resolveElements(elements, activeState);
  const selectedEl = selectedIds.length === 1 ? displayElements.find((e) => e.id === selectedIds[0]) : undefined;
  const others = presence.filter((u) => u.email !== myEmail);

  return (
    <div className="app-shell">
      <div className="main-area">
        <div className="topbar">
          <div className="breadcrumb">
            <Link to={`/workspaces/${diagram.workspace_id}`}>← Workspace</Link>
            {breadcrumb.map((c, i) => (
              <span key={c.id}>
                {' / '}
                {i === breadcrumb.length - 1 ? c.name : <Link to={`/diagrams/${c.id}`}>{c.name}</Link>}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
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
            <button className="btn" onClick={() => setShowHistory((s) => !s)}>
              History
            </button>
            <button
              className="btn"
              onClick={() => downloadAuthed(api.exportUrl('diagrams', diagram.id, 'svg'), `${diagram.name}.svg`)}
            >
              Export SVG
            </button>
            <button className="btn btn-danger" onClick={deleteDiagram}>
              Delete
            </button>
          </div>
        </div>

        <div style={{ padding: '8px 16px 0' }}>
          <div className="tabs">
            <button className={`tab-btn ${tab === 'canvas' ? 'active' : ''}`} onClick={() => setTab('canvas')}>
              Canvas
            </button>
            <button className={`tab-btn ${tab === 'dsl' ? 'active' : ''}`} onClick={() => setTab('dsl')}>
              DSL / Mermaid
            </button>
          </div>
        </div>

        <StatesBar
          states={states}
          activeStateId={activeStateId}
          onSelect={setActiveStateId}
          onAdd={addState}
          onRename={renameState}
          onMove={moveState}
          onDelete={deleteState}
          onPresent={() => setPresenting(true)}
        />

        {presenting && (
          <PresentMode
            base={elements}
            states={states}
            startIndex={startStepIndex(states, activeStateId)}
            onClose={() => setPresenting(false)}
          />
        )}

        {tab === 'canvas' ? (
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <DiagramCanvas
                elements={displayElements}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                onDrillDown={(id) => navigate(`/diagrams/${id}`)}
                onCreateElement={handleCreateElement}
                onUpdateElement={handleUpdateElement}
                onMoveLive={handleMoveLive}
                onDeleteElements={handleDeleteElements}
                onCursorMove={handleCursorMove}
                liveOverrides={liveOverrides}
                remoteCursors={remoteCursors}
              />
            </div>
            {(showHistory || selectedEl) && (
              <div style={{ width: 240, padding: 12, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {selectedEl && selectedEl.type !== 'connector' && (
                  <div className="panel">
                    <strong style={{ fontSize: 12 }}>Selected: {selectedEl.type}</strong>
                    {activeState && (
                      <label style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={!selectedEl.hidden}
                          onChange={(e) => overrideEdit(selectedEl.id!, { hidden: !e.target.checked })}
                        />{' '}
                        Visible in “{activeState.name}”
                      </label>
                    )}
                    {!activeState && selectedEl.type !== 'group' && (
                      <label style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={!selectedEl.hidden}
                          onChange={(e) =>
                            handleUpdateElement(selectedEl.id!, { style: { ...selectedEl.style, baseHidden: !e.target.checked } })
                          }
                        />{' '}
                        Visible in Base
                      </label>
                    )}
                    {selectedEl.linkedDiagramId ? (
                      <button className="btn" style={{ marginTop: 8, width: '100%' }} onClick={() => navigate(`/diagrams/${selectedEl.linkedDiagramId}`)}>
                        Open child diagram →
                      </button>
                    ) : (
                      <button className="btn" style={{ marginTop: 8, width: '100%' }} onClick={linkSelectedToChild}>
                        Link to new child diagram
                      </button>
                    )}
                  </div>
                )}
                {showHistory && (
                  <VersionHistoryPanel resourceKind="diagram" resourceId={diagram.id} onRestored={restoreVersion} />
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="content" style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <h3>Clara DSL</h3>
              <p className="muted">
                {'node A "Service A"'} · {'edge A -> B "calls"'} · {'group G "Group" { A B }'}
              </p>
              <textarea
                className="md-source"
                style={{ minHeight: 300 }}
                value={dslText}
                onChange={(e) => setDslText(e.target.value)}
              />
              <div className="editor-toolbar">
                <button className="btn btn-primary" onClick={applyDsl}>
                  Apply to canvas
                </button>
                <button className="btn" onClick={exportMermaid}>
                  Export as Mermaid
                </button>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <h3>Import Mermaid</h3>
              <p className="muted">Paste flowchart syntax, e.g. {'A[Service A] --> B[Service B]'}</p>
              <textarea
                className="md-source"
                style={{ minHeight: 300 }}
                value={mermaidText}
                onChange={(e) => setMermaidText(e.target.value)}
              />
              <div className="editor-toolbar">
                <button className="btn btn-primary" onClick={importMermaid}>
                  Import to canvas
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
