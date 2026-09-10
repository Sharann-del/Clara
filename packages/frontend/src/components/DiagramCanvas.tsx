import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiagramElement } from '../lib/api';

type Tool = 'select' | 'rect' | 'ellipse' | 'text' | 'connector';

interface Props {
  elements: DiagramElement[];
  onChange: (elements: DiagramElement[]) => void;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onDrillDown: (linkedDiagramId: string) => void;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}

function shapeCenter(el: DiagramElement): { x: number; y: number } {
  return { x: num(el.geometry.x) + num(el.geometry.width, 120) / 2, y: num(el.geometry.y) + num(el.geometry.height, 60) / 2 };
}

function connectorPoints(el: DiagramElement, all: DiagramElement[]) {
  const fromId = el.geometry.fromId as string | undefined;
  const toId = el.geometry.toId as string | undefined;
  const from = fromId ? all.find((e) => e.id === fromId) : undefined;
  const to = toId ? all.find((e) => e.id === toId) : undefined;
  if (from && to) {
    const a = shapeCenter(from);
    const b = shapeCenter(to);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }
  return { x1: num(el.geometry.x1), y1: num(el.geometry.y1), x2: num(el.geometry.x2), y2: num(el.geometry.y2) };
}

export function DiagramCanvas({ elements, onChange, selectedIds, onSelectionChange, onDrillDown }: Props) {
  const [tool, setTool] = useState<Tool>('select');
  const [pan, setPan] = useState({ x: 60, y: 40 });
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);
  const connectorFrom = useRef<string | null>(null);
  const drag = useRef<
    | { kind: 'move'; ids: string[]; startX: number; startY: number; origin: Map<string, { x: number; y: number }> }
    | { kind: 'create'; type: 'rect' | 'ellipse'; startX: number; startY: number; id: string }
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

  function updateElement(id: string, patch: Partial<DiagramElement['geometry']>) {
    onChange(elements.map((e) => (e.id === id ? { ...e, geometry: { ...e.geometry, ...patch } } : e)));
  }

  function addElement(el: DiagramElement) {
    onChange([...elements, el]);
  }

  function deleteSelected() {
    const ids = new Set(selectedIds);
    onChange(
      elements.filter(
        (e) => !ids.has(e.id ?? '') && !ids.has((e.geometry.fromId as string) ?? '__x') && !ids.has((e.geometry.toId as string) ?? '__x'),
      ),
    );
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
      const id = crypto.randomUUID();
      drag.current = { kind: 'create', type: tool, startX: x, startY: y, id };
      addElement({
        id,
        type: tool,
        geometry: { x, y, width: 1, height: 1, text: '' },
        style: { fill: tool === 'rect' ? '#eff6ff' : '#f0fdf4', stroke: tool === 'rect' ? '#2563eb' : '#16a34a' },
        zIndex: 1,
      });
    } else if (tool === 'text') {
      const text = window.prompt('Text:', '') ?? '';
      if (text) {
        addElement({
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
        addElement({
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
    if (!drag.current) return;
    const { x, y } = toWorld(e.clientX, e.clientY);

    if (drag.current.kind === 'create') {
      const { startX, startY, id } = drag.current;
      updateElement(id, {
        x: Math.min(startX, x),
        y: Math.min(startY, y),
        width: Math.max(4, Math.abs(x - startX)),
        height: Math.max(4, Math.abs(y - startY)),
      });
    } else if (drag.current.kind === 'move') {
      const { startX, startY, origin } = drag.current;
      const dx = x - startX;
      const dy = y - startY;
      onChange(
        elements.map((el) => {
          const o = el.id ? origin.get(el.id) : undefined;
          if (!o) return el;
          return { ...el, geometry: { ...el.geometry, x: o.x + dx, y: o.y + dy } };
        }),
      );
    } else if (drag.current.kind === 'resize') {
      const { id, startX, startY, origW, origH } = drag.current;
      updateElement(id, {
        width: Math.max(20, origW + (x - startX)),
        height: Math.max(20, origH + (y - startY)),
      });
    } else if (drag.current.kind === 'marquee') {
      const { startX, startY } = drag.current;
      setMarquee({ x: Math.min(startX, x), y: Math.min(startY, y), w: Math.abs(x - startX), h: Math.abs(y - startY) });
    }
  }

  function onMouseUp() {
    if (drag.current?.kind === 'marquee' && marquee) {
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
    if (next !== null) updateElement(el.id!, { text: next });
  }

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
            {elements
              .filter((el) => el.type !== 'connector')
              .sort((a, b) => a.zIndex - b.zIndex)
              .map((el) => {
                const selected = selectedIds.includes(el.id!);
                const x = num(el.geometry.x);
                const y = num(el.geometry.y);
                const w = num(el.geometry.width, 120);
                const h = num(el.geometry.height, 60);
                const hasLink = Boolean(el.linkedDiagramId ?? el.geometry.linkedDiagramId);

                if (el.type === 'text') {
                  return (
                    <text
                      key={el.id}
                      x={x}
                      y={y}
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
                    <g key={el.id}>
                      <rect
                        x={x}
                        y={y}
                        width={w}
                        height={h}
                        fill="none"
                        stroke="#94a3b8"
                        strokeDasharray="6 4"
                        rx={8}
                      />
                      <text x={x + 8} y={y + 16} fontSize={12} fill="#64748b">
                        {String(el.geometry.text ?? '')}
                      </text>
                    </g>
                  );
                }

                const Shape = el.type === 'ellipse' ? 'ellipse' : 'rect';
                return (
                  <g key={el.id}>
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
                const { x1, y1, x2, y2 } = connectorPoints(el, elements);
                return (
                  <g key={el.id}>
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
          </g>
        </svg>
      </div>

    </div>
  );
}
