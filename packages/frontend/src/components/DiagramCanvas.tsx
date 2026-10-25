import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DiagramElement } from '../lib/api';
import type { ResolvedElement } from '../lib/states';
import {
  DARK_PALETTE,
  connectorSegment,
  diagramBounds,
  elementBox,
  inkColor,
  lineY,
  shapeColors,
  wrapLabel,
  type Box,
} from '@clara/shared/render';
import { Icon, type IconName } from './ui/Icon';
import { colorFor } from './Presence';
import { MOD } from '../lib/shortcuts';

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
  /** Viewers: pan, zoom, select and drill down only. */
  readOnly?: boolean;
}

interface Editing {
  id: string | null; // null = a new text element
  x: number;
  y: number;
  width: number;
  height: number;
  value: string;
  kind: DiagramElement['type'];
}

const P = DARK_PALETTE;
const ghost = (el: ResolvedElement) => (el.hidden ? 0.25 : 1);
const num = (v: unknown, fallback = 0) => (typeof v === 'number' ? v : fallback);
const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return (
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
  );
};

const TOOLS: [Tool, IconName, string, string][] = [
  ['select', 'pointer', 'Select', 'V'],
  ['rect', 'square', 'Rectangle', 'R'],
  ['ellipse', 'circle', 'Ellipse', 'O'],
  ['text', 'type', 'Text', 'T'],
  ['connector', 'arrowUpRight', 'Connector', 'C'],
];
const KEY_TOOL: Record<string, Tool> = { v: 'select', r: 'rect', o: 'ellipse', t: 'text', c: 'connector' };

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
  readOnly,
}: Props) {
  const [tool, setTool] = useState<Tool>('select');
  const [pan, setPan] = useState({ x: 60, y: 40 });
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);
  const [connectorFrom, setConnectorFrom] = useState<string | null>(null);
  const lastCursorSend = useRef(0);
  const [editing, setEditing] = useState<Editing | null>(null);

  // Local-only render overrides while THIS user drags/resizes/creates — kept out of the shared
  // `elements` prop until mouseup, when the final position is persisted.
  const [localGeom, setLocalGeom] = useState<
    Record<string, { x?: number; y?: number; width?: number; height?: number }>
  >({});
  const [creating, setCreating] = useState<DiagramElement | null>(null);

  const drag = useRef<
    | { kind: 'move'; ids: string[]; startX: number; startY: number; origin: Map<string, { x: number; y: number }> }
    | { kind: 'create'; type: 'rect' | 'ellipse'; startX: number; startY: number }
    | { kind: 'marquee'; startX: number; startY: number }
    | { kind: 'resize'; id: string; startX: number; startY: number; origW: number; origH: number }
    | { kind: 'pan'; startX: number; startY: number; origin: { x: number; y: number } }
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

  const pickTool = (t: Tool) => {
    setTool(t);
    setConnectorFrom(null);
  };

  function deleteSelected() {
    const ids = new Set(selectedIds);
    const toDelete = elements
      .filter(
        (e) =>
          ids.has(e.id ?? '') ||
          ids.has((e.geometry.fromId as string) ?? '__x') ||
          ids.has((e.geometry.toId as string) ?? '__x'),
      )
      .map((e) => e.id!);
    onDeleteElements(toDelete);
    onSelectionChange([]);
  }

  /** Copies the selected shapes (and connectors between them) 24px down-right, and selects the copies. */
  function duplicateSelected() {
    const ids = new Set(selectedIds);
    const map = new Map<string, string>();
    const shapes = elements.filter((e) => e.id && ids.has(e.id) && e.type !== 'connector');
    for (const s of shapes) map.set(s.id!, crypto.randomUUID());
    for (const s of shapes) {
      onCreateElement({
        ...s,
        id: map.get(s.id!),
        linkedDiagramId: null,
        geometry: { ...s.geometry, x: num(s.geometry.x) + 24, y: num(s.geometry.y) + 24 },
      });
    }
    for (const c of elements.filter(
      (e) => e.type === 'connector' && map.has(e.geometry.fromId as string) && map.has(e.geometry.toId as string),
    )) {
      onCreateElement({
        ...c,
        id: crypto.randomUUID(),
        geometry: {
          ...c.geometry,
          fromId: map.get(c.geometry.fromId as string),
          toId: map.get(c.geometry.toId as string),
        },
      });
    }
    onSelectionChange([...map.values()]);
  }

  function nudge(dx: number, dy: number) {
    for (const id of selectedIds) {
      const el = elements.find((e) => e.id === id);
      if (!el || el.type === 'connector') continue;
      onUpdateElement(id, { geometry: { ...el.geometry, x: num(el.geometry.x) + dx, y: num(el.geometry.y) + dy } });
    }
  }

  function zoomBy(factor: number, cx?: number, cy?: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    const px = cx ?? (rect ? rect.width / 2 : 0);
    const py = cy ?? (rect ? rect.height / 2 : 0);
    setZoom((z) => {
      const nz = Math.min(3, Math.max(0.2, z * factor));
      setPan((p) => ({ x: px - ((px - p.x) * nz) / z, y: py - ((py - p.y) * nz) / z }));
      return nz;
    });
  }

  /** Zoom and pan so the whole diagram is in view (never above 100%). */
  const fit = useCallback(() => {
    const svg = svgRef.current;
    const b = diagramBounds(elements.filter((e) => !e.hidden));
    if (!svg || !b) return;
    const { width: cw, height: ch } = svg.getBoundingClientRect();
    if (!cw || !ch) return;
    const pad = 48;
    const z = Math.min(
      1,
      Math.max(0.2, Math.min((cw - pad * 2) / Math.max(b.width, 1), (ch - pad * 2) / Math.max(b.height, 1))),
    );
    setZoom(z);
    setPan({ x: (cw - b.width * z) / 2 - b.x * z, y: (ch - b.height * z) / 2 - b.y * z });
  }, [elements]);

  // Fit once if the canvas opens with content. Drawing on an empty canvas never moves the camera.
  useLayoutEffect(() => {
    if (elements.length > 0) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startEditing(el: DiagramElement) {
    if (readOnly || el.type === 'connector') return;
    const b = elementBox(el);
    setEditing({
      id: el.id!,
      x: b.x,
      y: b.y,
      width: Math.max(b.width, 120),
      height: Math.max(b.height, 28),
      value: String(el.geometry.text ?? ''),
      kind: el.type,
    });
  }

  function commitEditing(value: string | null) {
    const e = editing;
    setEditing(null);
    if (!e || value === null) return;
    if (e.id === null) {
      if (value.trim()) {
        const id = crypto.randomUUID();
        onCreateElement({
          id,
          type: 'text',
          geometry: { x: e.x, y: e.y + 14, text: value },
          style: { fontSize: 14, color: '#0f172a' },
          zIndex: 2,
        });
        onSelectionChange([id]);
      }
      return;
    }
    const el = elements.find((x) => x.id === e.id);
    if (el && value !== String(el.geometry.text ?? ''))
      onUpdateElement(e.id, { geometry: { ...el.geometry, text: value } });
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTyping(e.target) || editing || document.querySelector('dialog[open]')) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (!mod && !e.altKey && KEY_TOOL[k] && !readOnly) {
        pickTool(KEY_TOOL[k]);
        return;
      }
      if (e.key === 'Escape') {
        onSelectionChange([]);
        pickTool('select');
        return;
      }
      if (!mod && (e.key === '+' || e.key === '=')) return zoomBy(1.15);
      if (!mod && e.key === '-') return zoomBy(1 / 1.15);
      if (!mod && e.key === '0') return fit();
      if (mod && k === 'a') {
        e.preventDefault();
        onSelectionChange(elements.filter((x) => x.type !== 'connector').map((x) => x.id!));
        return;
      }
      if (readOnly || selectedIds.length === 0) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      } else if (mod && k === 'd') {
        e.preventDefault();
        duplicateSelected();
      } else if (e.key === 'Enter' && selectedIds.length === 1) {
        e.preventDefault();
        const el = elements.find((x) => x.id === selectedIds[0]);
        if (el) startEditing(el);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        nudge(
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
        );
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Ctrl/⌘+wheel (and trackpad pinch) zooms toward the cursor; plain wheel pans.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = svg.getBoundingClientRect();
        zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else {
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  });

  function onBackgroundMouseDown(e: React.MouseEvent) {
    if (editing) {
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    const { x, y } = toWorld(e.clientX, e.clientY);
    if (e.button === 1 || (e.button === 0 && (e.altKey || readOnly))) {
      drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, origin: pan };
      return;
    }
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
      // Keep the browser from moving focus on this mousedown, or it would blur (and close) the new editor.
      e.preventDefault();
      setEditing({ id: null, x, y, width: 180, height: 28, value: '', kind: 'text' });
      setTool('select');
    } else if (tool === 'connector') {
      setConnectorFrom(null);
    } else {
      drag.current = { kind: 'marquee', startX: x, startY: y };
      onSelectionChange([]);
    }
  }

  function onShapeMouseDown(e: React.MouseEvent, el: DiagramElement) {
    e.stopPropagation();
    // The editor's blur (which saves it) only fires after this mousedown; save first so the click isn't lost.
    if (editing) (document.activeElement as HTMLElement | null)?.blur();
    if (tool === 'connector' && !readOnly) {
      if (!connectorFrom) {
        setConnectorFrom(el.id!);
      } else if (connectorFrom !== el.id) {
        onCreateElement({
          id: crypto.randomUUID(),
          type: 'connector',
          geometry: { fromId: connectorFrom, toId: el.id, text: '' },
          style: { stroke: '#475569' },
          zIndex: 0,
        });
        setConnectorFrom(null);
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
    if (readOnly) return;

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
    if (now - lastCursorSend.current > 80) {
      lastCursorSend.current = now;
      onCursorMove(x, y);
    }
    const d = drag.current;
    if (!d) return;

    if (d.kind === 'pan') {
      setPan({ x: d.origin.x + e.clientX - d.startX, y: d.origin.y + e.clientY - d.startY });
    } else if (d.kind === 'create') {
      setCreating((prev) =>
        prev
          ? {
              ...prev,
              geometry: {
                ...prev.geometry,
                x: Math.min(d.startX, x),
                y: Math.min(d.startY, y),
                width: Math.max(4, Math.abs(x - d.startX)),
                height: Math.max(4, Math.abs(y - d.startY)),
              },
            }
          : prev,
      );
    } else if (d.kind === 'move') {
      const next: Record<string, { x: number; y: number }> = {};
      for (const [id, o] of d.origin) {
        next[id] = { x: o.x + x - d.startX, y: o.y + y - d.startY };
        onMoveLive(id, next[id].x, next[id].y);
      }
      setLocalGeom((prev) => ({ ...prev, ...next }));
    } else if (d.kind === 'resize') {
      setLocalGeom((prev) => ({
        ...prev,
        [d.id]: { width: Math.max(20, d.origW + (x - d.startX)), height: Math.max(20, d.origH + (y - d.startY)) },
      }));
    } else if (d.kind === 'marquee') {
      setMarquee({
        x: Math.min(d.startX, x),
        y: Math.min(d.startY, y),
        w: Math.abs(x - d.startX),
        h: Math.abs(y - d.startY),
      });
    }
  }

  function onMouseUp() {
    const d = drag.current;
    if (d?.kind === 'move') {
      for (const id of d.ids) {
        const el = elements.find((e) => e.id === id);
        const g = localGeom[id];
        if (el && g) onUpdateElement(id, { geometry: { ...el.geometry, x: g.x, y: g.y } });
      }
      setLocalGeom({});
    } else if (d?.kind === 'resize') {
      const el = elements.find((e) => e.id === d.id);
      const g = localGeom[d.id];
      if (el && g) onUpdateElement(d.id, { geometry: { ...el.geometry, width: g.width, height: g.height } });
      setLocalGeom({});
    } else if (d?.kind === 'create' && creating) {
      // A click without a drag makes a default-size shape.
      const tiny = num(creating.geometry.width) < 12 && num(creating.geometry.height) < 12;
      const el = tiny ? { ...creating, geometry: { ...creating.geometry, width: 140, height: 60 } } : creating;
      onCreateElement(el);
      onSelectionChange([el.id!]);
      setCreating(null);
      setTool('select');
      startEditing(el);
    } else if (d?.kind === 'marquee' && marquee) {
      const ids = elements
        .filter((el) => el.type !== 'connector')
        .filter((el) => {
          const b = elementBox(el);
          return (
            b.x >= marquee.x &&
            b.y >= marquee.y &&
            b.x + b.width <= marquee.x + marquee.w &&
            b.y + b.height <= marquee.y + marquee.h
          );
        })
        .map((el) => el.id!);
      onSelectionChange(ids);
    }
    drag.current = null;
    setMarquee(null);
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
  const byId = new Map(elements.filter((e) => e.id).map((e) => [e.id as string, e as DiagramElement]));
  /** Box of an element as currently drawn (including drags in progress), so attached connectors follow it. */
  const liveBox = (el: DiagramElement): Box => {
    const g = geomFor(el);
    if (el.type === 'text') return elementBox({ ...el, geometry: { ...el.geometry, x: g.x, y: g.y } });
    return g;
  };
  const shapeProps = (el: ResolvedElement, label: string) => ({
    tabIndex: 0,
    role: 'button',
    'aria-label': `${label}${el.linkedDiagramId ? ', opens a child diagram' : ''}${el.hidden ? ', hidden in this state' : ''}`,
    'aria-pressed': selectedIds.includes(el.id!),
    // Keyboard focus selects; a mouse click already handled selection (incl. shift-click) on mousedown.
    onFocus: (e: React.FocusEvent<Element>) => {
      if (e.currentTarget.matches(':focus-visible') && !selectedIds.includes(el.id!)) onSelectionChange([el.id!]);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && el.linkedDiagramId) onDrillDown(el.linkedDiagramId);
    },
  });

  const hint =
    tool === 'connector'
      ? connectorFrom
        ? 'Now click the shape the arrow points to · Esc to cancel'
        : 'Click the shape the arrow starts from'
      : tool === 'rect' || tool === 'ellipse'
        ? 'Drag to draw, or click for a default size'
        : tool === 'text'
          ? 'Click where the text should go'
          : null;

  return (
    <div className="canvas-shell">
      {!readOnly && (
        <div className="canvas-toolbar" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
          {TOOLS.map(([t, icon, label, key]) => (
            <button
              key={t}
              type="button"
              className={`canvas-tool-btn ${tool === t ? 'active' : ''}`}
              title={`${label} (${key})`}
              aria-label={`${label} (${key})`}
              aria-pressed={tool === t}
              onClick={() => pickTool(t)}
            >
              <Icon name={icon} size={17} />
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="canvas-tool-btn"
            title={`Duplicate (${MOD}+D)`}
            aria-label="Duplicate selection"
            disabled={!selectedIds.length}
            onClick={duplicateSelected}
          >
            <Icon name="copy" size={16} />
          </button>
          <button
            type="button"
            className="canvas-tool-btn"
            title="Delete (Del)"
            aria-label="Delete selection"
            disabled={!selectedIds.length}
            onClick={deleteSelected}
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
      )}

      <div className="canvas-viewport">
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          role="application"
          aria-roledescription="diagram canvas"
          aria-label={
            readOnly
              ? 'Diagram (view only). Drag to pan.'
              : 'Diagram canvas. Tools: V select, R rectangle, O ellipse, T text, C connector. Tab moves between shapes; Enter edits text.'
          }
          style={{
            cursor:
              drag.current?.kind === 'pan'
                ? 'grabbing'
                : tool === 'select'
                  ? readOnly
                    ? 'grab'
                    : 'default'
                  : 'crosshair',
          }}
          onMouseDown={onBackgroundMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onContextMenu={(e) => e.altKey && e.preventDefault()}
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill={P.connector} />
            </marker>
          </defs>
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {renderElements
              .filter((el) => el.type !== 'connector')
              .sort((a, b) => a.zIndex - b.zIndex)
              .map((el) => {
                const selected = selectedIds.includes(el.id!);
                const { x, y, width: w, height: h } = geomFor(el);
                const hasLink = Boolean(el.linkedDiagramId);
                const text = String(el.geometry.text ?? '');
                const isEditing = editing?.id === el.id;

                if (el.type === 'text') {
                  return (
                    <text
                      key={el.id}
                      x={x}
                      y={y}
                      className="canvas-shape"
                      opacity={isEditing ? 0 : ghost(el)}
                      fontSize={num(el.style.fontSize, 14)}
                      fill={inkColor(el.style.color, P)}
                      onMouseDown={(e) => onShapeMouseDown(e, el)}
                      onDoubleClick={() => startEditing(el)}
                      style={{ cursor: readOnly ? 'default' : 'move', userSelect: 'none' }}
                      textDecoration={selected ? 'underline' : undefined}
                      {...shapeProps(el, `Text: ${text}`)}
                    >
                      {text}
                    </text>
                  );
                }

                if (el.type === 'group') {
                  return (
                    <g
                      key={el.id}
                      opacity={ghost(el)}
                      className="canvas-shape"
                      onMouseDown={(e) => onShapeMouseDown(e, el)}
                      onDoubleClick={() => startEditing(el)}
                      {...shapeProps(el, `Group: ${text}`)}
                    >
                      <rect
                        x={x}
                        y={y}
                        width={w}
                        height={h}
                        fill="transparent"
                        stroke={selected ? P.accent : P.group}
                        strokeWidth={selected ? 2 : 1}
                        strokeDasharray="6 4"
                        rx={8}
                      />
                      {!isEditing && (
                        <text x={x + 8} y={y + 16} fontSize={12} fill={P.muted}>
                          {text}
                        </text>
                      )}
                    </g>
                  );
                }

                const colors = shapeColors(el.style.fill, el.style.stroke, P);
                const fill = colors.fill;
                const stroke = selected ? P.accent : colors.stroke;
                const common = {
                  fill,
                  stroke,
                  strokeWidth: selected ? 2.5 : 1.5,
                  style: {
                    cursor: readOnly ? (hasLink ? 'pointer' : 'default') : tool === 'connector' ? 'crosshair' : 'move',
                  },
                };
                return (
                  <g
                    key={el.id}
                    opacity={ghost(el)}
                    className={`canvas-shape ${connectorFrom === el.id ? 'connector-source' : ''}`}
                    onMouseDown={(e) => onShapeMouseDown(e, el)}
                    onDoubleClick={() =>
                      hasLink && (readOnly || !selected) ? onDrillDown(el.linkedDiagramId as string) : startEditing(el)
                    }
                    {...shapeProps(el, `${el.type === 'ellipse' ? 'Ellipse' : 'Box'}: ${text || 'no label'}`)}
                  >
                    {el.type === 'ellipse' ? (
                      <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />
                    ) : (
                      <rect x={x} y={y} width={w} height={h} rx={6} {...common} />
                    )}
                    {!isEditing && (
                      <ShapeLabel
                        text={text}
                        x={x}
                        y={y}
                        w={w}
                        h={h}
                        ellipse={el.type === 'ellipse'}
                        fill={colors.text}
                      />
                    )}
                    {hasLink && (
                      <g
                        style={{ pointerEvents: 'none' }}
                        stroke={stroke}
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        fill="none"
                      >
                        <path d={`M${x + w - 18} ${y + 6}h12v12`} />
                        <path d={`M${x + w - 6} ${y + 6}l-7 7`} />
                      </g>
                    )}
                    {selected && !readOnly && selectedIds.length === 1 && (
                      <rect
                        x={x + w - 6}
                        y={y + h - 6}
                        width={12}
                        height={12}
                        rx={2}
                        fill={P.accent}
                        stroke={P.canvas}
                        style={{ cursor: 'nwse-resize' }}
                        onMouseDown={(e) => onResizeHandleMouseDown(e, el)}
                        aria-hidden="true"
                      />
                    )}
                  </g>
                );
              })}

            {elements
              .filter((el) => el.type === 'connector')
              .map((el) => {
                const seg = connectorSegment(el, byId, liveBox);
                if (!seg) return null;
                const { x1, y1, x2, y2 } = seg;
                const selected = selectedIds.includes(el.id!);
                return (
                  <g
                    key={el.id}
                    opacity={ghost(el)}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      if (tool === 'select') onSelectionChange(e.shiftKey ? [...selectedIds, el.id!] : [el.id!]);
                    }}
                    onDoubleClick={() =>
                      !readOnly &&
                      setEditing({
                        id: el.id!,
                        x: (x1 + x2) / 2 - 60,
                        y: (y1 + y2) / 2 - 14,
                        width: 120,
                        height: 26,
                        value: String(el.geometry.text ?? ''),
                        kind: 'connector',
                      })
                    }
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Wide invisible hit area so thin arrows are easy to click. */}
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} />
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={selected ? P.accent : inkColor(el.style.stroke, P, P.connector)}
                      strokeWidth={selected ? 2.5 : 1.5}
                      markerEnd="url(#arrow)"
                    />
                    {Boolean(el.geometry.text) && editing?.id !== el.id && (
                      <text
                        x={(x1 + x2) / 2}
                        y={(y1 + y2) / 2 - 4}
                        fontSize={11}
                        fill={P.connector}
                        textAnchor="middle"
                        stroke={P.halo}
                        strokeWidth={3}
                        paintOrder="stroke"
                      >
                        {String(el.geometry.text)}
                      </text>
                    )}
                  </g>
                );
              })}

            {marquee && (
              <rect
                x={marquee.x}
                y={marquee.y}
                width={marquee.w}
                height={marquee.h}
                fill="none"
                stroke={P.accent}
                strokeDasharray="4 3"
              />
            )}

            {Object.entries(remoteCursors).map(([userId, c]) => (
              <g
                key={userId}
                style={{ pointerEvents: 'none' }}
                transform={`translate(${c.x},${c.y}) scale(${1 / zoom})`}
              >
                <path d="M0 0l13 6.5-5.5 1.6L5 14z" fill={colorFor(userId)} stroke={P.canvas} strokeWidth={1.2} />
                <text x={12} y={22} fontSize={11} fontWeight={600} fill={colorFor(userId)}>
                  {c.email ?? userId.slice(0, 6)}
                </text>
              </g>
            ))}
          </g>
        </svg>

        {editing && (
          <InlineTextEditor
            key={editing.id ?? 'new'}
            editing={editing}
            pan={pan}
            zoom={zoom}
            onCommit={(v) => commitEditing(v)}
            onCancel={() => commitEditing(null)}
          />
        )}
        {hint && !readOnly && (
          <div className="canvas-hint" role="status">
            {hint}
          </div>
        )}
        <div className="canvas-zoom" role="toolbar" aria-label="Zoom">
          <button
            type="button"
            className="btn btn-icon btn-sm btn-ghost"
            onClick={() => zoomBy(1 / 1.15)}
            aria-label="Zoom out"
          >
            <Icon name="zoomOut" />
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost canvas-zoom-pct"
            onClick={() => zoomBy(1 / zoom)}
            aria-label="Zoom to 100%"
            title="Zoom to 100%"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="btn btn-icon btn-sm btn-ghost"
            onClick={() => zoomBy(1.15)}
            aria-label="Zoom in"
          >
            <Icon name="zoomIn" />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-sm btn-ghost"
            onClick={fit}
            aria-label="Zoom to fit (0)"
            title="Zoom to fit (0)"
          >
            <Icon name="maximize" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** A text field laid over the canvas at the element's position; Enter saves, Esc cancels. */
function InlineTextEditor({
  editing,
  pan,
  zoom,
  onCommit,
  onCancel,
}: {
  editing: Editing;
  pan: { x: number; y: number };
  zoom: number;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(editing.value);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) onCommit(value);
    else onCancel();
  };
  const centered = editing.kind === 'rect' || editing.kind === 'ellipse';
  const h = centered ? 30 : editing.height;
  return (
    <input
      ref={ref}
      className="canvas-text-input"
      aria-label="Shape text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
      style={{
        left: pan.x + editing.x * zoom,
        top: pan.y + (centered ? editing.y + editing.height / 2 - h / 2 / zoom : editing.y) * zoom,
        width: editing.width * zoom,
        height: h,
        fontSize: 13 * Math.max(0.8, Math.min(zoom, 1.6)),
        textAlign: centered ? 'center' : 'left',
      }}
    />
  );
}

/** A shape's label, word-wrapped to the shape (and shrunk if it still doesn't fit). */
export function ShapeLabel({
  text,
  x,
  y,
  w,
  h,
  ellipse,
  fill,
}: {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ellipse: boolean;
  fill: string;
}) {
  if (!text) return null;
  const wrap = wrapLabel(text, w, h, ellipse);
  return (
    <text
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={wrap.fontSize}
      fill={fill}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      {wrap.lines.map((line, i) => (
        <tspan key={i} x={x + w / 2} y={lineY(wrap, y + h / 2, i)}>
          {line}
        </tspan>
      ))}
    </text>
  );
}
