import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type DiagramElement, type DiagramFull } from '../lib/api';
import { DiagramCanvas } from '../components/DiagramCanvas';
import { VersionHistoryPanel } from '../components/VersionHistoryPanel';
import { downloadAuthed } from '../lib/download';
import { layoutToElements, parseClaraDsl, parseMermaid, toMermaid } from '../lib/dsl';

type Tab = 'canvas' | 'dsl';

interface Crumb {
  id: string;
  name: string;
}

export function DiagramPage() {
  const { diagramId } = useParams<{ diagramId: string }>();
  const navigate = useNavigate();

  const [diagram, setDiagram] = useState<DiagramFull | null>(null);
  const [elements, setElements] = useState<DiagramElement[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('canvas');
  const [dslText, setDslText] = useState('');
  const [mermaidText, setMermaidText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<Crumb[]>([]);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadedElementsRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!diagramId) return;
    const d = await api.getDiagram(diagramId);
    setDiagram(d);
    setElements(d.elements.map((e) => ({ ...e })));
    loadedElementsRef.current = diagramId;
    setSelectedIds([]);
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
    load();
  }, [load]);

  function handleElementsChange(next: DiagramElement[]) {
    setElements(next);
    if (!diagramId) return;
    setSaving('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const saved = await api.saveDiagramElements(diagramId, next);
      setElements(saved.map((e) => ({ ...e })));
      setSaving('saved');
    }, 700);
  }

  async function applyDsl() {
    if (!diagramId) return;
    const graph = parseClaraDsl(dslText);
    const laidOut = layoutToElements(graph);
    handleElementsChange(laidOut);
    await api.setDiagramSource(diagramId, dslText, 'clara');
  }

  function importMermaid() {
    const graph = parseMermaid(mermaidText);
    if (graph.nodes.length === 0) {
      alert('No nodes found — check the Mermaid syntax (e.g. `A[Label] --> B[Label]`).');
      return;
    }
    handleElementsChange(layoutToElements(graph));
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
    const child = await api.createDiagram(diagram!.workspace_id, 'Untitled diagram', diagram!.folder_id, diagramId);
    const next = elements.map((el) => (el.id === selectedIds[0] ? { ...el, linkedDiagramId: child.id } : el));
    handleElementsChange(next);
  }

  async function deleteDiagram() {
    if (!diagramId || !diagram) return;
    if (!confirm(`Delete "${diagram.name}"?`)) return;
    await api.deleteDiagram(diagramId);
    navigate(`/workspaces/${diagram.workspace_id}`);
  }

  if (!diagram) return <div style={{ padding: 24 }}>Loading…</div>;

  const selectedEl = selectedIds.length === 1 ? elements.find((e) => e.id === selectedIds[0]) : undefined;

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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="muted">{saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : ''}</span>
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

        {tab === 'canvas' ? (
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <DiagramCanvas
                elements={elements}
                onChange={handleElementsChange}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                onDrillDown={(id) => navigate(`/diagrams/${id}`)}
              />
            </div>
            {(showHistory || selectedEl) && (
              <div style={{ width: 240, padding: 12, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {selectedEl && selectedEl.type !== 'connector' && (
                  <div className="panel">
                    <strong style={{ fontSize: 12 }}>Selected: {selectedEl.type}</strong>
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
                  <VersionHistoryPanel resourceKind="diagram" resourceId={diagram.id} onRestored={load} />
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
