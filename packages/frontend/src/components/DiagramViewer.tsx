import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DARK_PALETTE, renderDiagramSvg, type RenderableElement } from '@clara/shared/render';
import { Icon } from './ui/Icon';

interface Props {
  elements: RenderableElement[];
  /** Outline colour per element id (e.g. amber for a proposed addition). */
  highlights?: Record<string, string>;
  /** Clicking a shape that links to a child diagram. */
  onDrillDown?: (diagramId: string) => void;
  /** Re-fit when the content changes until the user pans/zooms themselves. Default true. */
  autoFit?: boolean;
  /** Show the zoom/fit controls. Default true. */
  controls?: boolean;
  /** Max zoom used when fitting (small diagrams don't get blown up). */
  maxFitScale?: number;
  className?: string;
  label?: string;
  /** Message for an empty diagram. */
  emptyText?: string;
}

const MIN = 0.1;
const MAX = 4;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

/**
 * Read-only diagram view: the shared static SVG renderer inside a pan/zoom surface.
 * Drag (mouse or one finger) pans, Ctrl/⌘+wheel or pinch zooms, plain wheel scrolls the page.
 * Keyboard when focused: + / − zoom, 0 fit, arrows pan.
 */
export function DiagramViewer({
  elements,
  highlights,
  onDrillDown,
  autoFit = true,
  controls = true,
  maxFitScale = 1.25,
  className = '',
  label,
  emptyText = 'Nothing to show yet',
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const userMoved = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; dist?: number; view: typeof view; moved: boolean } | null>(null);

  const rendered = useMemo(
    () =>
      renderDiagramSvg(elements, {
        background: null,
        padding: 24,
        dataAttributes: true,
        highlights,
        palette: DARK_PALETTE,
      }),
    [elements, highlights],
  );
  const empty = elements.filter((e) => !e.hidden).length === 0;

  const fit = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const { clientWidth: cw, clientHeight: ch } = host;
    if (!cw || !ch) return;
    const k = clamp(Math.min(cw / rendered.width, ch / rendered.height, maxFitScale) * 0.94);
    setView({ k, x: (cw - rendered.width * k) / 2, y: (ch - rendered.height * k) / 2 });
  }, [rendered.width, rendered.height, maxFitScale]);

  useLayoutEffect(() => {
    if (autoFit && !userMoved.current) fit();
  }, [fit, autoFit]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!userMoved.current) fit();
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [fit]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    userMoved.current = true;
    setView((v) => {
      const host = hostRef.current;
      const px = cx ?? (host ? host.clientWidth / 2 : 0);
      const py = cy ?? (host ? host.clientHeight / 2 : 0);
      const k = clamp(v.k * factor);
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  }, []);

  // Wheel needs a non-passive listener to be able to preventDefault the browser zoom.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = host.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pts = [...pointers.current.values()];
    if (pts.length === 1) gesture.current = { x: e.clientX, y: e.clientY, view, moved: false };
    else if (pts.length === 2) {
      const [a, b] = pts;
      gesture.current = {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        view,
        moved: true,
      };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2 && g.dist) {
      const [a, b] = pts;
      const r = hostRef.current!.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - r.left;
      const my = (a.y + b.y) / 2 - r.top;
      const k = clamp(g.view.k * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist));
      const ox = g.x - r.left;
      const oy = g.y - r.top;
      userMoved.current = true;
      setView({ k, x: mx - ((ox - g.view.x) * k) / g.view.k, y: my - ((oy - g.view.y) * k) / g.view.k });
      return;
    }
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;
    userMoved.current = true;
    setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
  }

  function onPointerUp(e: React.PointerEvent) {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      // A click (no drag) on a linked shape drills down.
      if (g && !g.moved && onDrillDown) {
        const link = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('[data-link]');
        const id = link?.getAttribute('data-link');
        if (id) onDrillDown(id);
      }
      gesture.current = null;
    } else if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      gesture.current = { x: p.x, y: p.y, view, moved: true };
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = 60;
    const keys: Record<string, () => void> = {
      '+': () => zoomAt(1.2),
      '=': () => zoomAt(1.2),
      '-': () => zoomAt(1 / 1.2),
      '0': () => {
        userMoved.current = false;
        fit();
      },
      ArrowLeft: () => setView((v) => ({ ...v, x: v.x + step })),
      ArrowRight: () => setView((v) => ({ ...v, x: v.x - step })),
      ArrowUp: () => setView((v) => ({ ...v, y: v.y + step })),
      ArrowDown: () => setView((v) => ({ ...v, y: v.y - step })),
    };
    const fn = keys[e.key];
    if (fn && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (e.key.startsWith('Arrow')) userMoved.current = true;
      fn();
    }
  }

  const shapes = elements.filter((e) => !e.hidden && e.type !== 'connector').length;
  const links = elements.filter((e) => !e.hidden && e.type === 'connector').length;
  const names = elements
    .filter((e) => !e.hidden && e.type !== 'connector' && e.geometry.text)
    .slice(0, 12)
    .map((e) => String(e.geometry.text))
    .join(', ');

  return (
    <div className={`viewer ${className}`}>
      <div
        ref={hostRef}
        className="viewer-surface canvas-viewport"
        tabIndex={0}
        role="img"
        aria-roledescription="diagram"
        aria-label={label ?? `Diagram with ${shapes} shapes and ${links} connections${names ? `: ${names}` : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        {empty ? (
          <div className="viewer-empty">{emptyText}</div>
        ) : (
          <div
            className="viewer-content"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
              width: rendered.width,
              height: rendered.height,
            }}
            // Safe: renderDiagramSvg escapes all text and only passes through validated colour values.
            dangerouslySetInnerHTML={{ __html: rendered.svg }}
          />
        )}
      </div>
      {controls && !empty && (
        <div className="viewer-controls" role="toolbar" aria-label="Zoom">
          <button type="button" className="btn btn-icon btn-sm" onClick={() => zoomAt(1 / 1.2)} aria-label="Zoom out">
            <Icon name="zoomOut" />
          </button>
          <span className="viewer-zoom" aria-live="polite">
            {Math.round(view.k * 100)}%
          </span>
          <button type="button" className="btn btn-icon btn-sm" onClick={() => zoomAt(1.2)} aria-label="Zoom in">
            <Icon name="zoomIn" />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-sm"
            onClick={() => {
              userMoved.current = false;
              fit();
            }}
            aria-label="Fit to view"
          >
            <Icon name="maximize" />
          </button>
        </div>
      )}
    </div>
  );
}
