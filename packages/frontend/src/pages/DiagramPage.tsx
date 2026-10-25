import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toMermaid } from '@clara/shared/dsl';
import { DARK_PALETTE, shapeColors } from '@clara/shared/render';
import { AppShell, Crumbs } from '../components/AppShell';
import { NoAccess } from '../components/NoAccess';
import { DiagramCanvas, type RemoteCursor } from '../components/DiagramCanvas';
import { DiagramViewer } from '../components/DiagramViewer';
import { CodeEditor } from '../components/CodeEditor';
import { StatesBar } from '../components/StatesBar';
import { PresentMode } from '../components/PresentMode';
import { VersionHistoryPanel } from '../components/VersionHistoryPanel';
import { ShareDialog } from '../components/ShareDialog';
import { TagEditor } from '../components/TagEditor';
import { DiagramPicker } from '../components/InsertDiagramDialog';
import { Presence, type PresenceUser } from '../components/Presence';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/ui/Icon';
import { Menu } from '../components/ui/Menu';
import { useToast } from '../components/ui/Toast';
import { useConfirm } from '../components/ui/ConfirmProvider';
import { useRegisterWorkspace } from '../components/CommandPalette';
import {
  api,
  ApiError,
  errorMessage,
  normalizeElement,
  type DiagramElement,
  type DiagramFull,
  type DiagramState,
  type ElementOverride,
  type Role,
  type Workspace,
} from '../lib/api';
import { mergeOverride, planCreate, resolveElements, startStepIndex, type ResolvedElement } from '../lib/states';
import { exportDiagram, type ExportFormat } from '../lib/exporters';
import { compileDiagram, describeCompile } from '../lib/diagramFromCode';
import { detectFormat, type CodeFormat } from '../lib/share';
import { connectRealtime, type RealtimeConnection, type RealtimeStatus } from '../lib/realtimeSocket';
import { useAuth } from '../context/AuthContext';
import { useFavorites } from '../lib/favorites';
import { useIsNarrow } from '../lib/useMediaQuery';
import { usePageMeta } from '../lib/seo';

type Tab = 'canvas' | 'code';
interface Crumb {
  id: string;
  name: string;
}
const RANK: Role[] = ['viewer', 'editor', 'admin', 'owner'];

const SWATCHES: { fill: string; stroke: string; name: string }[] = [
  { fill: '#eff6ff', stroke: '#2563eb', name: 'Blue' },
  { fill: '#f0fdf4', stroke: '#16a34a', name: 'Green' },
  { fill: '#fef2f2', stroke: '#dc2626', name: 'Red' },
  { fill: '#faf5ff', stroke: '#7c3aed', name: 'Purple' },
  { fill: '#f8fafc', stroke: '#475569', name: 'Grey' },
  { fill: '#ffffff', stroke: '#0f172a', name: 'Plain' },
];

export function DiagramPage() {
  const { diagramId, '*': sub } = useParams<{ diagramId: string; '*': string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm, prompt } = useConfirm();
  const { email: myEmail } = useAuth();
  const { isFavorite, toggle: toggleFavorite } = useFavorites();
  const narrow = useIsNarrow();

  const [diagram, setDiagram] = useState<DiagramFull | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [elements, setElements] = useState<DiagramElement[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('canvas');
  const [code, setCode] = useState('');
  const [codeFormat, setCodeFormat] = useState<CodeFormat>('clara');
  const [breadcrumb, setBreadcrumb] = useState<Crumb[]>([]);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [liveOverrides, setLiveOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor>>({});
  const [states, setStates] = useState<DiagramState[]>([]);
  const [activeStateId, setActiveStateId] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [panel, setPanel] = useState<'tags' | 'link' | null>(null);
  const base = `/diagrams/${diagramId}`;
  const [diagramNames, setDiagramNames] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [rtStatus, setRtStatus] = useState<RealtimeStatus>('connecting');

  const rtRef = useRef<RealtimeConnection | null>(null);
  const activeStateIdRef = useRef<string | null>(null);
  activeStateIdRef.current = activeStateId;
  useRegisterWorkspace(diagram?.workspace_id);
  usePageMeta(diagram?.name, { noindex: true });

  const role: Role | undefined = diagram?.role ?? workspace?.role;
  const canEdit = !!role && RANK.indexOf(role) >= 1;
  const canDelete = !!workspace?.role && RANK.indexOf(workspace.role) >= 1;
  const editable = canEdit && !narrow;

  const load = useCallback(async () => {
    if (!diagramId) return;
    const d = await api.getDiagram(diagramId);
    setDiagram(d);
    setElements(d.elements.map((e) => ({ ...e })));
    setSelectedIds([]);
    setStates(await api.listStates(diagramId));
    const source = await api.getDiagramSource(diagramId);
    setCode(source.dsl_text);
    setCodeFormat(source.format === 'mermaid' ? 'mermaid' : 'clara');
    api
      .getWorkspace(d.workspace_id)
      .then(setWorkspace)
      .catch(() => setWorkspace(null));
    api
      .listDiagrams(d.workspace_id)
      .then((list) => setDiagramNames(Object.fromEntries(list.map((x) => [x.id, x.name]))))
      .catch(() => undefined);

    const crumbs: Crumb[] = [{ id: d.id, name: d.name }];
    const seen = new Set([d.id]);
    let parentId = d.parent_diagram_id;
    while (parentId && !seen.has(parentId) && crumbs.length < 12) {
      seen.add(parentId);
      try {
        const parent = await api.getDiagram(parentId);
        crumbs.unshift({ id: parent.id, name: parent.name });
        parentId = parent.parent_diagram_id;
      } catch {
        break; // a parent you can't read just ends the trail
      }
    }
    setBreadcrumb(crumbs);
  }, [diagramId]);

  useEffect(() => {
    setLoadError(null);
    setDiagram(null);
    setActiveStateId(null);
    load().catch((e) => setLoadError(e instanceof ApiError ? e : new ApiError(0, errorMessage(e))));
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

  // Realtime: live cursors, element updates, presence (PRD 4.10).
  useEffect(() => {
    if (!diagramId || loadError || !diagram) return;
    setPresence([]);
    setRemoteCursors({});
    setLiveOverrides({});
    const rt = connectRealtime(
      'diagram',
      diagramId,
      (msg) => {
        switch (msg.type) {
          case 'presence.snapshot':
            setPresence(msg.users as PresenceUser[]);
            break;
          case 'presence.joined':
            setPresence((prev) => [
              ...prev.filter((u) => u.userId !== msg.userId),
              { userId: msg.userId as string, email: msg.email as string | undefined },
            ]);
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
              [msg.userId as string]: {
                x: msg.x as number,
                y: msg.y as number,
                email: msg.email as string | undefined,
              },
            }));
            break;
          case 'element.moving':
            if ((msg.stateId ?? null) !== activeStateIdRef.current) break;
            setLiveOverrides((prev) => ({ ...prev, [msg.id as string]: { x: msg.x as number, y: msg.y as number } }));
            break;
          case 'element.created':
          case 'element.updated': {
            const el = normalizeElement(msg.element as Record<string, unknown>);
            setElements((prev) => {
              const i = prev.findIndex((e) => e.id === el.id);
              if (i === -1) return [...prev, el];
              const next = [...prev];
              next[i] = el;
              return next;
            });
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
            applyOverrideLocally(
              msg.stateId as string,
              msg.elementId as string,
              msg.override as ElementOverride | null,
            );
            break;
          case 'error':
            toast.error(String(msg.message ?? 'Live update was refused'));
            break;
        }
      },
      {
        onStatus: setRtStatus,
        onReconnect: () => {
          load();
          refreshStates();
        },
      },
    );
    rtRef.current = rt;
    return () => rt.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagramId, loadError, !!diagram, load, refreshStates, applyOverrideLocally]);

  const activeState = states.find((st) => st.id === activeStateId);
  const displayElements = useMemo(() => resolveElements(elements, activeState), [elements, activeState]);
  const compiled = useMemo(() => compileDiagram(code, codeFormat), [code, codeFormat]);

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

  function handleUpdateElement(
    id: string,
    patch: { geometry?: Record<string, unknown>; style?: Record<string, unknown> },
  ) {
    if (activeState) return overrideEdit(id, patch);
    setElements((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    rtRef.current?.send('element.update', { id, ...patch });
  }

  /** Drill-down links live on the base element, whichever state is showing. */
  function setLink(id: string, linkedDiagramId: string | null) {
    setElements((prev) => prev.map((e) => (e.id === id ? { ...e, linkedDiagramId } : e)));
    rtRef.current?.send('element.update', { id, linkedDiagramId });
  }

  function handleDeleteElements(ids: string[]) {
    if (activeState) {
      for (const id of ids) overrideEdit(id, { hidden: true });
      toast.show(`Hidden in “${activeState.name}”. It still exists in the base diagram.`);
      return;
    }
    const removed = elements.filter((e) => ids.includes(e.id!));
    setElements((prev) => prev.filter((e) => !ids.includes(e.id!)));
    for (const id of ids) rtRef.current?.send('element.delete', { id });
    if (removed.length) {
      toast.show(`Deleted ${removed.length} element${removed.length === 1 ? '' : 's'}`, {
        action: {
          label: 'Undo',
          onClick: () => {
            for (const el of removed) {
              setElements((prev) => [...prev, el]);
              rtRef.current?.send('element.create', { element: el });
            }
          },
        },
      });
    }
  }

  async function addState(name: string, copyFromActive: boolean) {
    if (!diagramId) return;
    try {
      const created = await api.createState(diagramId, name, copyFromActive ? (activeStateId ?? undefined) : undefined);
      setStates((prev) => [...prev, created]);
      setActiveStateId(created.id);
      rtRef.current?.send('states.refresh');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  async function renameState(id: string, name: string) {
    setStates((prev) => prev.map((st) => (st.id === id ? { ...st, name } : st)));
    await api.renameState(id, name).catch((e) => toast.error(errorMessage(e)));
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
    setStates(
      await api.reorderStates(
        diagramId,
        reordered.map((st) => st.id),
      ),
    );
    rtRef.current?.send('states.refresh');
  }
  async function deleteState(id: string) {
    await api.deleteState(id).catch((e) => toast.error(errorMessage(e)));
    setStates((prev) => prev.filter((st) => st.id !== id));
    if (activeStateId === id) setActiveStateId(null);
    rtRef.current?.send('states.refresh');
  }

  async function applyCode() {
    if (!diagramId) return;
    if (compiled.nodeCount === 0) {
      toast.error(
        codeFormat === 'mermaid'
          ? 'No nodes found. Check the syntax, e.g. A[Label] --> B[Label].'
          : 'No nodes found. Declare some with: node id "Label".',
      );
      return;
    }
    if (
      elements.length > 0 &&
      !(await confirm({
        title: 'Replace the canvas with this code?',
        message: `The ${elements.length} element${elements.length === 1 ? '' : 's'} on the canvas are replaced by a fresh layout of the code. The current version is saved to history first.`,
        confirmLabel: 'Apply to canvas',
      }))
    ) {
      return;
    }
    try {
      const saved = await api.saveDiagramElements(diagramId, compiled.elements);
      setElements(saved.map((e) => ({ ...e })));
      await api.setDiagramSource(diagramId, code, codeFormat);
      rtRef.current?.send('diagram.refresh');
      setTab('canvas');
      toast.success(`Applied: ${describeCompile(compiled)}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function runExport(format: ExportFormat) {
    try {
      const name = `${diagram?.name ?? 'diagram'}${activeState ? ` - ${activeState.name}` : ''}`;
      await exportDiagram(displayElements, name, format);
    } catch (e) {
      toast.error(`Export failed: ${errorMessage(e)}`);
    }
  }

  async function createChild(el: DiagramElement) {
    if (!diagram) return;
    const name = await prompt({
      title: 'Create a child diagram',
      message: 'A new diagram for the detail inside this shape. Double-click the shape to open it.',
      label: 'Name',
      defaultValue: String(el.geometry.text ?? '') || 'Untitled diagram',
      confirmLabel: 'Create and link',
    });
    if (!name) return;
    try {
      const child = await api.createDiagram(diagram.workspace_id, name, diagram.folder_id, diagram.id);
      setDiagramNames((m) => ({ ...m, [child.id]: child.name }));
      setLink(el.id!, child.id);
      toast.show(`Linked to new diagram “${child.name}”`, {
        tone: 'success',
        action: { label: 'Open', onClick: () => navigate(`/diagrams/${child.id}`) },
      });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function renameDiagram() {
    if (!diagram) return;
    const name = await prompt({
      title: 'Rename diagram',
      label: 'Name',
      defaultValue: diagram.name,
      confirmLabel: 'Rename',
    });
    if (!name || name === diagram.name) return;
    try {
      await api.updateDiagram(diagram.id, { name });
      setDiagram({ ...diagram, name });
      setBreadcrumb((c) => c.map((x) => (x.id === diagram.id ? { ...x, name } : x)));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function deleteDiagram() {
    if (!diagram) return;
    const ok = await confirm({
      title: `Delete “${diagram.name}”?`,
      message:
        'This deletes the diagram, its states and version history for everyone. Shapes elsewhere that link to it lose their link.',
      confirmLabel: 'Delete diagram',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteDiagram(diagram.id);
      toast.success(`Deleted “${diagram.name}”`);
      navigate(`/workspaces/${diagram.workspace_id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (loadError) {
    if (loadError.status === 403 || loadError.status === 404)
      return <NoAccess what="diagram" notFound={loadError.status === 404} />;
    return (
      <AppShell sidebarMode="drawer" title={<strong>Diagram</strong>}>
        <EmptyState
          icon="alert"
          title="This diagram didn’t load"
          actions={
            <button className="btn btn-primary" onClick={() => load().catch(() => undefined)}>
              Try again
            </button>
          }
        >
          {loadError.message}
        </EmptyState>
      </AppShell>
    );
  }

  const selectedEl: ResolvedElement | undefined =
    selectedIds.length === 1 ? displayElements.find((e) => e.id === selectedIds[0]) : undefined;
  const others = presence.filter((u) => u.email !== myEmail);
  const fav = diagram ? isFavorite('diagram', diagram.id) : false;

  return (
    <AppShell
      sidebarMode="drawer"
      workspace={workspace}
      bleed={!sub}
      title={
        <Crumbs
          items={[
            { label: workspace?.name ?? 'Workspace', to: diagram ? `/workspaces/${diagram.workspace_id}` : undefined },
            ...breadcrumb.map((c) => ({ label: c.name, to: `/diagrams/${c.id}` })),
          ]}
        />
      }
      actions={
        diagram && (
          <>
            <Presence users={others} />
            {(rtStatus === 'reconnecting' || rtStatus === 'offline') && (
              <span
                className="save-status"
                role="status"
                title="Live updates paused; edits are sent when the connection is back"
              >
                <Icon name="wifiOff" size={13} /> {rtStatus === 'offline' ? 'Offline' : 'Reconnecting…'}
              </span>
            )}
            {!canEdit && <span className="tag tag-neutral hide-mobile">View only</span>}
            <button
              type="button"
              className={`btn btn-ghost btn-icon star ${fav ? 'on' : ''}`}
              aria-pressed={fav}
              aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
              onClick={() =>
                toggleFavorite({ kind: 'diagram', id: diagram.id, name: diagram.name }).catch((e) =>
                  toast.error(errorMessage(e)),
                )
              }
            >
              <Icon name="star" />
            </button>
            <button type="button" className="btn hide-mobile" onClick={() => navigate(`${base}/share`)}>
              <Icon name="share" /> Share
            </button>
            <Menu
              trigger={
                <>
                  <Icon name="download" /> <span className="btn-label">Export</span>
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
            <Menu
              className="btn btn-ghost btn-icon"
              label="Diagram actions"
              trigger={<Icon name="more" />}
              items={[
                { label: 'Share', icon: 'share', onSelect: () => navigate(`${base}/share`) },
                { label: 'Present', icon: 'play', disabled: states.length === 0, onSelect: () => setPresenting(true) },
                { label: 'Version history', icon: 'history', onSelect: () => navigate(`${base}/history`) },
                ...(canEdit
                  ? [
                      { label: 'Rename', icon: 'edit' as const, onSelect: renameDiagram },
                      { label: 'Edit tags', icon: 'tag' as const, onSelect: () => setPanel('tags') },
                    ]
                  : []),
                ...(canDelete
                  ? [
                      'separator' as const,
                      { label: 'Delete diagram', icon: 'trash' as const, danger: true, onSelect: deleteDiagram },
                    ]
                  : []),
              ]}
            />
          </>
        )
      }
    >
      {!diagram ? (
        <div className="canvas-viewport" aria-busy="true" style={{ display: 'grid', placeItems: 'center' }}>
          <span className="spinner" />
        </div>
      ) : (
        <>
          {!sub && (
            <>
              <div className="diagram-subbar">
                <div className="tabs" role="tablist" aria-label="View">
                  <button
                    role="tab"
                    aria-selected={tab === 'canvas'}
                    className={`tab-btn ${tab === 'canvas' ? 'active' : ''}`}
                    onClick={() => setTab('canvas')}
                  >
                    Canvas
                  </button>
                  <button
                    role="tab"
                    aria-selected={tab === 'code'}
                    className={`tab-btn ${tab === 'code' ? 'active' : ''}`}
                    onClick={() => setTab('code')}
                  >
                    Code
                  </button>
                </div>
                {narrow && canEdit && (
                  <span className="muted">Editing works on a larger screen; this is a read-only view.</span>
                )}
              </div>

              <StatesBar
                readOnly={!editable}
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
                <div className="diagram-body">
                  <div className="diagram-stage">
                    {editable ? (
                      <DiagramCanvas
                        elements={displayElements}
                        selectedIds={selectedIds}
                        onSelectionChange={setSelectedIds}
                        onDrillDown={(id) => navigate(`/diagrams/${id}`)}
                        onCreateElement={handleCreateElement}
                        onUpdateElement={handleUpdateElement}
                        onMoveLive={(id, x, y) =>
                          rtRef.current?.send('element.moving', { id, x, y, stateId: activeStateId })
                        }
                        onDeleteElements={handleDeleteElements}
                        onCursorMove={(x, y) => rtRef.current?.send('cursor', { x, y })}
                        liveOverrides={liveOverrides}
                        remoteCursors={remoteCursors}
                      />
                    ) : displayElements.length === 0 ? (
                      <EmptyState icon="diagram" title="This diagram is empty">
                        {canEdit
                          ? 'Open it on a larger screen to draw, or write it as code.'
                          : 'Nothing has been drawn here yet.'}
                      </EmptyState>
                    ) : (
                      <DiagramViewer
                        elements={displayElements}
                        onDrillDown={(id) => navigate(`/diagrams/${id}`)}
                        label={`Diagram: ${diagram.name}`}
                      />
                    )}
                    {editable && elements.length === 0 && (
                      <div className="canvas-empty">
                        <strong>An empty canvas</strong>
                        <span>Pick a shape tool on the left (R for rectangle), or write the diagram as code.</span>
                        <button type="button" className="btn btn-sm" onClick={() => setTab('code')}>
                          <Icon name="code" /> Write it as code
                        </button>
                      </div>
                    )}
                  </div>
                  {editable && selectedIds.length > 0 && (
                    <Inspector
                      selected={selectedEl}
                      count={selectedIds.length}
                      activeState={activeState}
                      diagramNames={diagramNames}
                      onUpdate={handleUpdateElement}
                      onHide={(id, hidden) =>
                        activeState
                          ? overrideEdit(id, { hidden })
                          : handleUpdateElement(id, { style: { ...selectedEl!.style, baseHidden: hidden } })
                      }
                      onOpenLink={(id) => navigate(`/diagrams/${id}`)}
                      onPickLink={() => setPanel('link')}
                      onCreateChild={() => selectedEl && createChild(selectedEl)}
                      onUnlink={() => selectedEl && setLink(selectedEl.id!, null)}
                      onDelete={() => handleDeleteElements(selectedIds)}
                      onClose={() => setSelectedIds([])}
                    />
                  )}
                </div>
              ) : (
                <div className="code-tab">
                  <div className="code-tab-bar">
                    <div className="segmented" role="radiogroup" aria-label="Code format">
                      {(['clara', 'mermaid'] as CodeFormat[]).map((f) => (
                        <button
                          key={f}
                          type="button"
                          role="radio"
                          aria-checked={codeFormat === f}
                          className={codeFormat === f ? 'on' : ''}
                          onClick={() => setCodeFormat(f)}
                        >
                          {f === 'clara' ? 'Clara DSL' : 'Mermaid'}
                        </button>
                      ))}
                    </div>
                    <span className="spacer" />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setCode(toMermaid(elements));
                        setCodeFormat('mermaid');
                      }}
                      title="Replace the code with Mermaid generated from the canvas"
                    >
                      <Icon name="arrowLeft" /> Load from canvas
                    </button>
                    {editable && (
                      <button type="button" className="btn btn-primary" onClick={applyCode}>
                        <Icon name="arrowRight" /> Apply to canvas
                      </button>
                    )}
                  </div>
                  <div className="code-tab-body">
                    <div className="code-tab-editor">
                      <CodeEditor
                        id="diagram-code"
                        label={`Diagram code (${codeFormat === 'clara' ? 'Clara DSL' : 'Mermaid'})`}
                        value={code}
                        readOnly={!editable}
                        issues={compiled.issues}
                        placeholder={
                          codeFormat === 'clara'
                            ? 'node web "Web app"\nnode api "API"\nedge web -> api "REST"'
                            : 'flowchart LR\n  web[Web app] --> api[API]'
                        }
                        onChange={(v) => {
                          setCode(v);
                          if (!code.trim() && v.trim()) setCodeFormat(detectFormat(v));
                        }}
                      />
                      <div
                        id="diagram-code-status"
                        className={`code-status ${compiled.issues.length ? 'error' : ''}`}
                        aria-live="polite"
                      >
                        {describeCompile(compiled)}
                      </div>
                    </div>
                    <div className="code-tab-preview" aria-label="Preview of the code">
                      <DiagramViewer elements={compiled.elements} emptyText="The preview appears as you type" />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          <VersionHistoryPanel
            open={sub === 'history'}
            onClose={() => navigate(base, { replace: true })}
            backTo={base}
            resourceKind="diagram"
            resourceId={diagram.id}
            current={{ elements }}
            canRestore={canEdit}
            onRestored={async () => {
              await load();
              rtRef.current?.send('diagram.refresh');
            }}
          />
          <ShareDialog
            open={sub === 'share'}
            backTo={base}
            kind="diagram"
            id={diagram.id}
            name={diagram.name}
            workspaceName={workspace?.name}
            canManage={canEdit}
          />
          {panel === 'tags' && (
            <TagEditor
              open
              name={diagram.name}
              tags={diagram.tags}
              suggestions={[]}
              onClose={() => setPanel(null)}
              onSave={async (tags) => {
                setPanel(null);
                try {
                  await api.updateDiagram(diagram.id, { tags });
                  setDiagram({ ...diagram, tags });
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            />
          )}
          {panel === 'link' && selectedEl && (
            <DiagramPicker
              open
              title="Link to a diagram"
              description="Double-clicking this shape will open the diagram you pick (C4-style drill-down)."
              workspaceId={diagram.workspace_id}
              excludeIds={[diagram.id]}
              confirmLabel="Link"
              onClose={() => setPanel(null)}
              onPick={(d) => {
                setPanel(null);
                setLink(selectedEl.id!, d.id);
                setDiagramNames((m) => ({ ...m, [d.id]: d.name }));
                toast.success(`Linked to “${d.name}”`);
              }}
            />
          )}
        </>
      )}
    </AppShell>
  );
}

function Inspector({
  selected,
  count,
  activeState,
  diagramNames,
  onUpdate,
  onHide,
  onOpenLink,
  onPickLink,
  onCreateChild,
  onUnlink,
  onDelete,
  onClose,
}: {
  selected: ResolvedElement | undefined;
  count: number;
  activeState: DiagramState | undefined;
  diagramNames: Record<string, string>;
  onUpdate: (id: string, patch: { geometry?: Record<string, unknown>; style?: Record<string, unknown> }) => void;
  onHide: (id: string, hidden: boolean) => void;
  onOpenLink: (id: string) => void;
  onPickLink: () => void;
  onCreateChild: () => void;
  onUnlink: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(String(selected?.geometry.text ?? ''));
  useEffect(() => setText(String(selected?.geometry.text ?? '')), [selected?.id, selected?.geometry.text]);

  if (!selected) {
    return (
      <aside className="inspector" aria-label="Selection">
        <div className="inspector-head">
          <strong>{count} selected</strong>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            aria-label="Clear selection"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>
        <p className="muted">Drag to move them together, arrow keys to nudge, ⌘D to duplicate.</p>
        <button type="button" className="btn btn-danger" onClick={onDelete}>
          <Icon name="trash" /> {activeState ? `Hide in “${activeState.name}”` : 'Delete'}
        </button>
      </aside>
    );
  }

  const isShape = selected.type === 'rect' || selected.type === 'ellipse';
  const kindLabel = { rect: 'Box', ellipse: 'Ellipse', text: 'Text', connector: 'Arrow', group: 'Group' }[
    selected.type
  ];
  const commitText = () =>
    text !== String(selected.geometry.text ?? '') &&
    onUpdate(selected.id!, { geometry: { ...selected.geometry, text } });

  return (
    <aside className="inspector" aria-label={`${kindLabel} properties`}>
      <div className="inspector-head">
        <strong>{kindLabel}</strong>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close properties" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <label className="field">
        {selected.type === 'connector' ? 'Label' : 'Text'}
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => e.key === 'Enter' && commitText()}
        />
      </label>

      {isShape && (
        <fieldset className="field inspector-swatches">
          <legend>Colour</legend>
          <div>
            {SWATCHES.map((s) => (
              <button
                key={s.name}
                type="button"
                className={`swatch ${selected.style.stroke === s.stroke ? 'on' : ''}`}
                style={{ background: shapeColors(s.fill, s.stroke, DARK_PALETTE).stroke }}
                aria-label={s.name}
                aria-pressed={selected.style.stroke === s.stroke}
                onClick={() => onUpdate(selected.id!, { style: { ...selected.style, fill: s.fill, stroke: s.stroke } })}
              />
            ))}
          </div>
        </fieldset>
      )}

      {selected.type !== 'connector' && (
        <label className="checkbox">
          <input type="checkbox" checked={!selected.hidden} onChange={(e) => onHide(selected.id!, !e.target.checked)} />
          Visible in {activeState ? `“${activeState.name}”` : 'Base'}
        </label>
      )}

      {isShape && (
        <div className="inspector-section">
          <span className="inspector-label">Drill-down</span>
          {selected.linkedDiagramId ? (
            <>
              <p className="inspector-link">
                <Icon name="link" size={13} /> Opens{' '}
                <strong>{diagramNames[selected.linkedDiagramId] ?? 'a diagram'}</strong>
              </p>
              <div className="inspector-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => onOpenLink(selected.linkedDiagramId!)}
                >
                  Open
                </button>
                <button type="button" className="btn btn-sm" onClick={onPickLink}>
                  Change
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={onUnlink}>
                  <Icon name="unlink" size={13} /> Unlink
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: '0 0 6px' }}>
                Link this shape to a more detailed diagram.
              </p>
              <div className="inspector-actions">
                <button type="button" className="btn btn-sm" onClick={onPickLink}>
                  <Icon name="link" size={13} /> Link to diagram…
                </button>
                <button type="button" className="btn btn-sm" onClick={onCreateChild}>
                  <Icon name="plus" size={13} /> Create child
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        className="btn btn-ghost btn-danger"
        style={{ justifyContent: 'flex-start' }}
        onClick={onDelete}
      >
        <Icon name="trash" /> {activeState ? `Hide in “${activeState.name}”` : `Delete ${kindLabel.toLowerCase()}`}
      </button>
    </aside>
  );
}
