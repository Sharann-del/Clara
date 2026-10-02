import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiagramElement } from '../lib/api';
import type { ResolvedElement } from '../lib/states';

type Tool = 'select' | 'rect' | 'ellipse' | 'text' | 'connector';

export interface RemoteCursor {
  x: number;
  y: number;
  email?: string;
}

interface Props {
  /** Elements with the selected state's overrides applied; `hidden` ones are drawn ghosted so they can still be selected and un-hidden. */
  elements: ResolvedElement[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onDrillDown: (linkedDiagramId: string) => void;
  onCreateElement: (element: DiagramElement) => void;
  onUpdateElement: (id: string, patch: { geometry?: Record<string, unknown>; style?: Record<string, unknown> }) => void;
  onMoveLive: (id: string, x: number, y: number) => void;
  onDeleteElements: (ids: string[]) => void;
  onCursorMove: (x: number, y: number) => void;
  /** Other users' in-progress drags — rendered as a live preview, not yet persisted. */
  liveOverrides: Record<string, { x: number; y: number }>;
  remoteCursors: Record<string, RemoteCursor>;
}

const ghost = (el: ResolvedElement) => (el.hidden ? 0.25 : 1);

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}

function shapeCenter(el: DiagramElement, override?: { x: number; y: number }): { x: number; y: number } {
  const x = override?.x ?? num(el.geometry.x);
  const y = override?.y ?? num(el.geometry.y);
  return { x: x + num(el.geometry.width, 120) / 2, y: y + num(el.geometry.height, 60) / 2 };
}

function connectorPoints(el: DiagramElement, all: DiagramElement[], overrides: Record<string, { x: number; y: number }>) {
  const fromId = el.geometry.fromId as string | undefined;
  const toId = el.geometry.toId as string | undefined;
  const from = fromId ? all.find((e) => e.id === fromId) : undefined;
  const to = toId ? all.find((e) => e.id === toId) : undefined;
  if (from && to) {
    const a = shapeCenter(from, from.id ? overrides[from.id] : undefined);
    const b = shapeCenter(to, to.id ? overrides[to.id] : undefined);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }
  return { x1: num(el.geometry.x1), y1: num(el.geometry.y1), x2: num(el.geometry.x2), y2: num(el.geometry.y2) };
}

export function DiagramCanvas({
  elements,
  selectedIds,
  onSelectionChange,
  onDrillDown,
  onCreateElement,
  onUpdateElement,
  onMoveLive,
  onDeleteElements,
  onCursorMove,
  liveOverrides,
  remoteCursors,
}: Props) {
  const [tool, setTool] = useState<Tool>('select');
  const [pan, setPan] = useState({ x: 60, y: 40 });
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);
  const connectorFrom = useRef<string | null>(null);
  const lastCursorSend = useRef(0);

  // Local-only render overrides while THIS user drags/resizes/creates — kept
  // out of the shared `elements` prop until mouseup, when the final position
  // is persisted (see onUpdateElement/onCreateElement).
  const [localGeom, setLocalGeom] = useState<Record<string, { x?: number; y?: number; width?: number; height?: number }>>({});
  const [creating, setCreating] = useState<DiagramElement | null>(null);

  const drag = useRef<
    | { kind: 'move'; ids: string[]; startX: number; startY: number; origin: Map<string, { x: number; y: number }> }
    | { kind: 'create'; type: 'rect' | 'ellipse'; startX: number; startY: number }
    | { kind: 'marquee'; startX: number; startY: number }
    | { kind: 'resize'; id: string; startX: number; startY: number; origW: number; origH: number }
    | null
  >(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current!.getBoundingClientRect();
      return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom };
    },
    [pan, zoom],
  );

  function deleteSelected() {
    const ids = new Set(selectedIds);
    const toDelete = elements
      .filter(
        (e) => ids.has(e.id ?? '') || ids.has((e.geometry.fromId as string) ?? '__x') || ids.has((e.geometry.toId as string) ?? '__x'),
      )
      .map((e) => e.id!);
    onDeleteElements(toDelete);
    onSelectionChange([]);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        e.preventDefault();
        deleteSelected();
      }
      if (e.key === 'Escape') {
        onSelectionChange([]);
        connectorFrom.current = null;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function onBackgroundMouseDown(e: React.MouseEvent) {
    const { x, y } = toWorld(e.clientX, e.clientY);
    if (tool === 'rect' || tool === 'ellipse') {
      drag.current = { kind: 'create', type: tool, startX: x, startY: y };
      setCreating({
        id: crypto.randomUUID(),
        type: tool,
        geometry: { x, y, width: 1, height: 1, text: '' },
        style: { fill: tool === 'rect' ? '#eff6ff' : '#f0fdf4', stroke: tool === 'rect' ? '#2563eb' : '#16a34a' },
        zIndex: 1,
      });
    } else if (tool === 'text') {
      const text = window.prompt('Text:', '') ?? '';
      if (text) {
        onCreateElement({
          id: crypto.randomUUID(),
          type: 'text',
          geometry: { x, y, text },
          style: { fontSize: 14, color: '#0f172a' },
          zIndex: 2,
        });
      }
      setTool('select');
    } else if (tool === 'select') {
      drag.current = { kind: 'marquee', startX: x, startY: y };
      onSelectionChange([]);
    }
  }

  function onShapeMouseDown(e: React.MouseEvent, el: DiagramElement) {
    e.stopPropagation();
    if (tool === 'connector') {
      if (!connectorFrom.current) {
        connectorFrom.current = el.id!;
      } else if (connectorFrom.current !== el.id) {
        onCreateElement({
          id: crypto.randomUUID(),
          type: 'connector',
          geometry: { fromId: connectorFrom.current, toId: el.id },
          style: { stroke: '#475569' },
          zIndex: 0,
        });
        connectorFrom.current = null;
        setTool('select');
      }
      return;
    }
    if (tool !== 'select') return;

    const isSelected = selectedIds.includes(el.id!);
    const nextSelection = e.shiftKey
      ? isSelected
        ? selectedIds.filter((id) => id !== el.id)
        : [...selectedIds, el.id!]
      : isSelected
        ? selectedIds
        : [el.id!];
    onSelectionChange(nextSelection);

    const { x, y } = toWorld(e.clientX, e.clientY);
    const origin = new Map<string, { x: number; y: number }>();
    for (const id of nextSelection) {
      const found = elements.find((it) => it.id === id);
      if (found) origin.set(id, { x: num(found.geometry.x), y: num(found.geometry.y) });
    }
    drag.current = { kind: 'move', ids: nextSelection, startX: x, startY: y, origin };
  }

  function onResizeHandleMouseDown(e: React.MouseEvent, el: DiagramElement) {
    e.stopPropagation();
    const { x, y } = toWorld(e.clientX, e.clientY);
    drag.current = {
      kind: 'resize',
      id: el.id!,
      startX: x,
      startY: y,
      origW: num(el.geometry.width, 120),
      origH: num(el.geometry.height, 60),
    };
  }

  function onMouseMove(e: React.MouseEvent) {
    const { x, y } = toWorld(e.clientX, e.clientY);

    const now = Date.now();
    if (now - lastCursorSend.current > 60) {
      lastCursorSend.current = now;
      onCursorMove(x, y);
    }

    if (!drag.current) return;

    if (drag.current.kind === 'create') {
      const { startX, startY } = drag.current;
      setCreating((prev) =>
        prev
          ? {
              ...prev,
              geometry: {
                ...prev.geometry,
                x: Math.min(startX, x),
                y: Math.min(startY, y),
                width: Math.max(4, Math.abs(x - startX)),
                height: Math.max(4, Math.abs(y - startY)),
              },
            }
          : prev,
      );
    } else if (drag.current.kind === 'move') {
      const { startX, startY, origin } = drag.current;
      const dx = x - startX;
      const dy = y - startY;
      const next: Record<string, { x: number; y: number }> = {};
      for (const [id, o] of origin) {
        next[id] = { x: o.x + dx, y: o.y + dy };
        onMoveLive(id, next[id].x, next[id].y);
      }
      setLocalGeom((prev) => ({ ...prev, ...next }));
    } else if (drag.current.kind === 'resize') {
      const { id, startX, startY, origW, origH } = drag.current;
      setLocalGeom((prev) => ({
        ...prev,
        [id]: { width: Math.max(20, origW + (x - startX)), height: Math.max(20, origH + (y - startY)) },
      }));
    } else if (drag.current.kind === 'marquee') {
      const { startX, startY } = drag.current;
      setMarquee({ x: Math.min(startX, x), y: Math.min(startY, y), w: Math.abs(x - startX), h: Math.abs(y - startY) });
    }
  }

  function onMouseUp() {
    if (drag.current?.kind === 'move') {
      for (const id of drag.current.ids) {
        const el = elements.find((e) => e.id === id);
        const g = localGeom[id];
        if (el && g) onUpdateElement(id, { geometry: { ...el.geometry, x: g.x, y: g.y } });
      }
      setLocalGeom({});
    } else if (drag.current?.kind === 'resize') {
      const { id } = drag.current;
      const el = elements.find((e) => e.id === id);
      const g = localGeom[id];
      if (el && g) onUpdateElement(id, { geometry: { ...el.geometry, width: g.width, height: g.height } });
      setLocalGeom({});
    } else if (drag.current?.kind === 'create' && creating) {
      onCreateElement(creating);
      setCreating(null);
      setTool('select');
    } else if (drag.current?.kind === 'marquee' && marquee) {
      const ids = elements
        .filter((el) => el.type !== 'connector')
        .filter((el) => {
          const ex = num(el.geometry.x);
          const ey = num(el.geometry.y);
          return ex >= marquee.x && ey >= marquee.y && ex <= marquee.x + marquee.w && ey <= marquee.y + marquee.h;
        })
        .map((el) => el.id!);
      onSelectionChange(ids);
    }
    drag.current = null;
    setMarquee(null);
  }

  function onWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom((z) => Math.min(3, Math.max(0.25, z - e.deltaY * 0.001)));
    } else {
      setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  }

  function editText(el: DiagramElement) {
    const next = window.prompt('Edit text:', String(el.geometry.text ?? ''));
    if (next !== null) onUpdateElement(el.id!, { geometry: { ...el.geometry, text: next } });
  }

  function geomFor(el: DiagramElement) {
    const remote = el.id ? liveOverrides[el.id] : undefined;
    const local = el.id ? localGeom[el.id] : undefined;
    return {
      x: local?.x ?? remote?.x ?? num(el.geometry.x),
      y: local?.y ?? remote?.y ?? num(el.geometry.y),
      width: local?.width ?? num(el.geometry.width, 120),
      height: local?.height ?? num(el.geometry.height, 60),
    };
  }

  const renderElements = creating ? [...elements, creating] : elements;

  return (
    <div className="canvas-shell">
      <div className="canvas-toolbar">
        {(
          [
            ['select', '⭯'],
            ['rect', '▭'],
            ['ellipse', '◯'],
            ['text', 'T'],
            ['connector', '↗'],
          ] as [Tool, string][]
        ).map(([t, icon]) => (
          <button
            key={t}
            className={`canvas-tool-btn ${tool === t ? 'active' : ''}`}
            title={t}
            onClick={() => {
              setTool(t);
              connectorFrom.current = null;
            }}
          >
            {icon}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="canvas-tool-btn" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, z - 0.1))}>
          −
        </button>
        <button className="canvas-tool-btn" title="Reset zoom" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button className="canvas-tool-btn" title="Zoom in" onClick={() => setZoom((z) => Math.min(3, z + 0.1))}>
          +
        </button>
      </div>

      <div className="canvas-viewport">
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          onMouseDown={onBackgroundMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
        >
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#475569" />
            </marker>
          </defs>
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {renderElements
              .filter((el) => el.type !== 'connector')
              .sort((a, b) => a.zIndex - b.zIndex)
              .map((el) => {
                const selected = selectedIds.includes(el.id!);
                const { x, y, width: w, height: h } = geomFor(el);
                const hasLink = Boolean(el.linkedDiagramId ?? el.geometry.linkedDiagramId);

                if (el.type === 'text') {
                  return (
                    <text
                      key={el.id}
                      x={x}
                      y={y}
                      opacity={ghost(el)}
                      fontSize={num(el.style.fontSize, 14)}
                      fill={String(el.style.color ?? '#0f172a')}
                      onMouseDown={(e) => onShapeMouseDown(e, el)}
                      onDoubleClick={() => editText(el)}
                      style={{ cursor: 'move', userSelect: 'none' }}
                    >
                      {String(el.geometry.text ?? '')}
                    </text>
                  );
                }

                if (el.type === 'group') {
                  return (
                    <g key={el.id} opacity={ghost(el)}>
                      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#94a3b8" strokeDasharray="6 4" rx={8} />
                      <text x={x + 8} y={y + 16} fontSize={12} fill="#64748b">
                        {String(el.geometry.text ?? '')}
                      </text>
                    </g>
                  );
                }

                const Shape = el.type === 'ellipse' ? 'ellipse' : 'rect';
                return (
                  <g key={el.id} opacity={ghost(el)}>
                    {Shape === 'rect' ? (
                      <rect
                        x={x}
                        y={y}
                        width={w}
                        height={h}
                        rx={6}
                        fill={String(el.style.fill ?? '#fff')}
                        stroke={selected ? '#2563eb' : String(el.style.stroke ?? '#1f2937')}
                        strokeWidth={selected ? 2.5 : 1.5}
                        onMouseDown={(e) => onShapeMouseDown(e, el)}
                        onDoubleClick={() => (hasLink ? onDrillDown((el.linkedDiagramId ?? el.geometry.linkedDiagramId) as string) : editText(el))}
                        style={{ cursor: tool === 'connector' ? 'crosshair' : 'move' }}
                      />
                    ) : (
                      <ellipse
                        cx={x + w / 2}
                        cy={y + h / 2}
                        rx={w / 2}
                        ry={h / 2}
                        fill={String(el.style.fill ?? '#fff')}
                        stroke={selected ? '#2563eb' : String(el.style.stroke ?? '#1f2937')}
                        strokeWidth={selected ? 2.5 : 1.5}
                        onMouseDown={(e) => onShapeMouseDown(e, el)}
                        onDoubleClick={() => editText(el)}
                        style={{ cursor: tool === 'connector' ? 'crosshair' : 'move' }}
                      />
                    )}
                    <text
                      x={x + w / 2}
                      y={y + h / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={13}
                      fill="#0f172a"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {String(el.geometry.text ?? '')}
                    </text>
                    {hasLink && (
                      <text x={x + w - 16} y={y + 16} fontSize={12} style={{ pointerEvents: 'none' }}>
                        🔗
                      </text>
                    )}
                    {selected && (
                      <rect
                        x={x + w - 6}
                        y={y + h - 6}
                        width={12}
                        height={12}
                        fill="#2563eb"
                        style={{ cursor: 'nwse-resize' }}
                        onMouseDown={(e) => onResizeHandleMouseDown(e, el)}
                      />
                    )}
                  </g>
                );
              })}

            {elements
              .filter((el) => el.type === 'connector')
              .map((el) => {
                const { x1, y1, x2, y2 } = connectorPoints(el, elements, { ...liveOverrides, ...localGeom } as Record<string, { x: number; y: number }>);
                return (
                  <g key={el.id} opacity={ghost(el)}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#475569" strokeWidth={1.5} markerEnd="url(#arrow)" />
                    {Boolean(el.geometry.text) && (
                      <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} fontSize={11} fill="#475569" textAnchor="middle">
                        {String(el.geometry.text)}
                      </text>
                    )}
                  </g>
                );
              })}

            {marquee && (
              <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill="#2563eb22" stroke="#2563eb" />
            )}

            {Object.entries(remoteCursors).map(([userId, c]) => (
              <g key={userId} style={{ pointerEvents: 'none' }}>
                <circle cx={c.x} cy={c.y} r={4} fill="#db2777" />
                <text x={c.x + 8} y={c.y - 6} fontSize={11} fill="#db2777">
                  {c.email ?? userId.slice(0, 6)}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}
