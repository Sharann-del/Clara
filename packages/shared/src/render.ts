import type { DiagramElement } from './dsl.js';
import { lineY, wrapLabel } from './text.js';

export { lineY, wrapLabel, type WrappedLabel } from './text.js';

/**
 * Framework-free diagram geometry + a static SVG renderer. One implementation shared by
 * the server's SVG export, the client's SVG/PNG/PDF export, the public playground and
 * Mermaid export, so a connector resolves to the same two shapes everywhere.
 *
 * Connectors come in two stored shapes:
 *  - attached: `geometry.fromId` / `geometry.toId` reference other elements (what the
 *    canvas connector tool draws); endpoints follow the shapes when they move.
 *  - free: absolute `geometry.x1/y1/x2/y2` (what the DSL / Mermaid importers and older
 *    data produce).
 * An attached connector whose ids no longer resolve falls back to its coordinates, if any.
 */

export type RenderableElement = DiagramElement & { hidden?: boolean };

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export const isShape = (el: DiagramElement) => el.type === 'rect' || el.type === 'ellipse';

/** Rough text extent — good enough for bounds and connector clipping without a DOM. */
function textBox(el: DiagramElement): Box {
  const fontSize = num(el.style.fontSize, 14);
  const text = String(el.geometry.text ?? '');
  return {
    x: num(el.geometry.x),
    y: num(el.geometry.y) - fontSize,
    width: Math.max(8, text.length * fontSize * 0.6),
    height: fontSize * 1.3,
  };
}

/** Bounding box of a non-connector element. */
export function elementBox(el: DiagramElement): Box {
  if (el.type === 'text') return textBox(el);
  return {
    x: num(el.geometry.x),
    y: num(el.geometry.y),
    width: num(el.geometry.width, 120),
    height: num(el.geometry.height, 60),
  };
}

/** Where the ray from the box centre towards (tx, ty) leaves the shape outline. */
function clipToOutline(el: DiagramElement, box: Box, tx: number, ty: number): { x: number; y: number } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const rx = box.width / 2;
  const ry = box.height / 2;
  const t =
    el.type === 'ellipse'
      ? 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2)
      : Math.min(dx === 0 ? Infinity : rx / Math.abs(dx), dy === 0 ? Infinity : ry / Math.abs(dy));
  return { x: cx + dx * Math.min(1, t), y: cy + dy * Math.min(1, t) };
}

const center = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** The elements an attached connector points at, when both ids resolve to non-connectors. */
export function connectorEnds(
  el: DiagramElement,
  byId: Map<string, DiagramElement>,
): { from: DiagramElement; to: DiagramElement } | undefined {
  const fromId = el.geometry.fromId;
  const toId = el.geometry.toId;
  if (typeof fromId !== 'string' || typeof toId !== 'string') return undefined;
  const from = byId.get(fromId);
  const to = byId.get(toId);
  if (!from || !to || from.type === 'connector' || to.type === 'connector') return undefined;
  return { from, to };
}

/** True when the connector carries usable absolute coordinates. */
export function hasCoordinates(el: DiagramElement): boolean {
  const g = el.geometry;
  return [g.x1, g.y1, g.x2, g.y2].every((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * Line to draw for a connector. Attached connectors run between the two shapes' outlines
 * (so the arrowhead stays visible); free ones use their stored coordinates. `boxOf` lets a
 * caller substitute live geometry (e.g. a shape mid-drag).
 */
export function connectorSegment(
  el: DiagramElement,
  byId: Map<string, DiagramElement>,
  boxOf: (el: DiagramElement) => Box = elementBox,
): Segment | undefined {
  const ends = connectorEnds(el, byId);
  if (ends) {
    const a = boxOf(ends.from);
    const b = boxOf(ends.to);
    const ca = center(a);
    const cb = center(b);
    const p = clipToOutline(ends.from, a, cb.x, cb.y);
    const q = clipToOutline(ends.to, b, ca.x, ca.y);
    return { x1: p.x, y1: p.y, x2: q.x, y2: q.y };
  }
  if (!hasCoordinates(el)) return undefined;
  const g = el.geometry;
  return { x1: num(g.x1), y1: num(g.y1), x2: num(g.x2), y2: num(g.y2) };
}

/** Elements that would be drawn: not hidden, and connectors only if both ends are drawn too. */
export function visibleElements<T extends RenderableElement>(elements: T[]): T[] {
  const shown = elements.filter((e) => !e.hidden);
  const ids = new Set(shown.map((e) => e.id));
  return shown.filter((e) => {
    if (e.type !== 'connector') return true;
    const { fromId, toId } = e.geometry;
    // An endpoint that exists but is hidden takes the connector with it.
    const hiddenEnd = (id: unknown) => typeof id === 'string' && !ids.has(id) && elements.some((x) => x.id === id);
    return !hiddenEnd(fromId) && !hiddenEnd(toId);
  });
}

/** Union bounding box of everything drawable, or undefined for an empty diagram. */
export function diagramBounds(elements: DiagramElement[]): Box | undefined {
  const byId = new Map(elements.filter((e) => e.id).map((e) => [e.id as string, e]));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const el of elements) {
    if (el.type === 'connector') {
      const s = connectorSegment(el, byId);
      if (s) {
        add(s.x1, s.y1);
        add(s.x2, s.y2);
      }
      continue;
    }
    const b = elementBox(el);
    add(b.x, b.y);
    add(b.x + b.width, b.y + b.height);
  }
  if (!Number.isFinite(minX)) return undefined;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Only pass through simple colour values into attributes (no `url(...)`, no quotes). */
function color(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|none)$/i.test(v.trim())
    ? v.trim()
    : fallback;
}

/** Colours a diagram is drawn with. Stored element colours are light-sheet values; the dark palette remaps them. */
export interface DiagramPalette {
  canvas: string;
  dot: string;
  ink: string;
  muted: string;
  connector: string;
  group: string;
  accent: string;
  /** Halo behind connector labels so they read over lines; matches the canvas. */
  halo: string;
}

export const LIGHT_PALETTE: DiagramPalette = {
  canvas: '#ffffff',
  dot: '#c7cedb',
  ink: '#0f172a',
  muted: '#64748b',
  connector: '#475569',
  group: '#94a3b8',
  accent: '#2563eb',
  halo: '#ffffff',
};

export const DARK_PALETTE: DiagramPalette = {
  canvas: '#0d0d0f',
  dot: '#26262b',
  ink: '#ededef',
  muted: '#85858e',
  connector: '#8a8a94',
  group: '#55555e',
  accent: '#8e98ff',
  halo: '#0d0d0f',
};

// The swatches the editor offers (and the defaults), redrawn as tinted dark fills / brighter strokes.
const DARK_FILLS: Record<string, string> = {
  '#ffffff': '#1c1c20',
  '#fff': '#1c1c20',
  '#eff6ff': '#1a2040',
  '#f0fdf4': '#12291f',
  '#fef2f2': '#331a1c',
  '#faf5ff': '#261d3d',
  '#f8fafc': '#202024',
};
const DARK_STROKES: Record<string, string> = {
  '#2563eb': '#8e98ff',
  '#2b50e8': '#8e98ff',
  '#16a34a': '#4cc79d',
  '#dc2626': '#f2786d',
  '#7c3aed': '#b197fc',
  '#475569': '#8a8a94',
  '#1f2937': '#6b6b75',
  '#0f172a': '#9a9aa4',
};

function isLight(hex: string): boolean {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return true;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

/** Fill, stroke and label colour for a shape under a palette. Unknown custom fills keep their colour and get a readable label. */
export function shapeColors(
  fill: unknown,
  stroke: unknown,
  palette: DiagramPalette = LIGHT_PALETTE,
): { fill: string; stroke: string; text: string } {
  const f = color(fill, '#ffffff').toLowerCase();
  const s = color(stroke, '#1f2937').toLowerCase();
  if (palette === LIGHT_PALETTE) return { fill: f, stroke: s, text: LIGHT_PALETTE.ink };
  const darkFill = DARK_FILLS[f];
  if (darkFill) return { fill: darkFill, stroke: DARK_STROKES[s] ?? s, text: palette.ink };
  return { fill: f, stroke: DARK_STROKES[s] ?? s, text: isLight(f) ? LIGHT_PALETTE.ink : palette.ink };
}

/** Colour for a free text element or connector under a palette. */
export function inkColor(v: unknown, palette: DiagramPalette = LIGHT_PALETTE, fallback = palette.ink): string {
  const c = color(v, fallback).toLowerCase();
  if (palette === LIGHT_PALETTE) return c;
  if (c === '#0f172a' || c === '#1f2937') return palette.ink;
  return DARK_STROKES[c] ?? c;
}

export interface SvgRenderOptions {
  /** Page background; `null` for transparent. Default white. */
  background?: string | null;
  padding?: number;
  /** Emit the `<?xml ...?>` prolog (for standalone .svg files). */
  xmlProlog?: boolean;
  /** Tag each drawn element with `data-el-id` (and `data-link` when it drills down) for click handling. */
  dataAttributes?: boolean;
  /** Outline colour per element id, e.g. to mark the elements a proposed change adds. */
  highlights?: Record<string, string>;
  /** Colour scheme; exports default to the light sheet. */
  palette?: DiagramPalette;
}

export interface RenderedSvg {
  svg: string;
  width: number;
  height: number;
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif";

/**
 * Static SVG for a list of elements, cropped to the content with `padding` around it.
 * Elements flagged `hidden` (or `style.baseHidden`, i.e. only shown in a state) are skipped,
 * so callers can pass a state-resolved list to export exactly what is on screen.
 */
export function renderDiagramSvg(all: RenderableElement[], opts: SvgRenderOptions = {}): RenderedSvg {
  const padding = opts.padding ?? 32;
  const pal = opts.palette ?? LIGHT_PALETTE;
  const background = opts.background === undefined ? '#ffffff' : opts.background;
  const elements = visibleElements(
    all.map((e) => (e.style?.baseHidden === true && e.hidden === undefined ? { ...e, hidden: true } : e)),
  );
  const byId = new Map(elements.filter((e) => e.id).map((e) => [e.id as string, e as DiagramElement]));

  const bounds = diagramBounds(elements) ?? { x: 0, y: 0, width: 400, height: 240 };
  const vx = Math.floor(bounds.x - padding);
  const vy = Math.floor(bounds.y - padding);
  const width = Math.ceil(bounds.width + padding * 2);
  const height = Math.ceil(bounds.height + padding * 2);

  const parts: string[] = [];
  const sorted = [...elements].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  // Shapes first, connectors on top — same stacking as the live canvas.
  const open = (el: DiagramElement) => {
    if (!opts.dataAttributes || !el.id) return '';
    const link = el.linkedDiagramId ? ` data-link="${escapeXml(el.linkedDiagramId)}"` : '';
    return `<g data-el-id="${escapeXml(el.id)}"${link}${link ? ' style="cursor:pointer"' : ''}>`;
  };
  const close = (el: DiagramElement) => (opts.dataAttributes && el.id ? '</g>' : '');
  const highlight = (el: DiagramElement) => {
    const c = el.id ? opts.highlights?.[el.id] : undefined;
    if (!c || el.type === 'connector') return '';
    const { x, y, width: w, height: h } = elementBox(el);
    return `<rect x="${x - 5}" y="${y - 5}" width="${w + 10}" height="${h + 10}" rx="9" fill="none" stroke="${color(c, '#f59e0b')}" stroke-width="2" stroke-dasharray="5 4" />`;
  };

  for (const el of sorted) {
    if (el.type === 'connector') continue;
    parts.push(open(el) + highlight(el));
    const g = el.geometry;
    const s = el.style;
    const text = escapeXml(String(g.text ?? ''));
    const { x, y, width: w, height: h } = elementBox(el);
    if (el.type === 'text') {
      parts.push(
        `<text x="${num(g.x)}" y="${num(g.y)}" font-size="${num(s.fontSize, 14)}" fill="${inkColor(s.color, pal)}">${text}</text>`,
      );
    } else if (el.type === 'group') {
      parts.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="none" stroke="${pal.group}" stroke-dasharray="6 4" />`,
        `<text x="${x + 8}" y="${y + 16}" font-size="12" fill="${pal.muted}">${text}</text>`,
      );
    } else {
      const { fill, stroke, text: label } = shapeColors(s.fill, s.stroke, pal);
      parts.push(
        el.type === 'ellipse'
          ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />`
          : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />`,
      );
      if (text) {
        parts.push(
          (() => {
            const wrap = wrapLabel(String(g.text ?? ''), w, h, el.type === 'ellipse');
            const spans = wrap.lines
              .map((l, i) => `<tspan x="${x + w / 2}" y="${num(lineY(wrap, y + h / 2, i))}">${escapeXml(l)}</tspan>`)
              .join('');
            return `<text text-anchor="middle" dominant-baseline="central" font-size="${wrap.fontSize}" fill="${label}">${spans}</text>`;
          })(),
        );
      }
      if (el.linkedDiagramId) {
        // Drill-down marker: a small "opens a child diagram" corner badge.
        parts.push(
          `<path d="M${x + w - 18} ${y + 6}h12v12" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" /><path d="M${x + w - 6} ${y + 6}l-7 7" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" />`,
        );
      }
    }
    parts.push(close(el));
  }
  for (const el of sorted) {
    if (el.type !== 'connector') continue;
    const seg = connectorSegment(el, byId);
    if (!seg) continue;
    const stroke = color(
      opts.highlights?.[el.id ?? ''] ?? inkColor(el.style.stroke, pal, pal.connector),
      pal.connector,
    );
    parts.push(
      `<line x1="${seg.x1}" y1="${seg.y1}" x2="${seg.x2}" y2="${seg.y2}" stroke="${stroke}" stroke-width="1.5" marker-end="url(#clara-arrow)" />`,
    );
    const label = String(el.geometry.text ?? '');
    if (label) {
      parts.push(
        `<text x="${(seg.x1 + seg.x2) / 2}" y="${(seg.y1 + seg.y2) / 2 - 4}" text-anchor="middle" font-size="11" fill="${pal.connector}" stroke="${pal.halo}" stroke-width="3" paint-order="stroke">${escapeXml(label)}</text>`,
      );
    }
  }

  const svg = `${opts.xmlProlog ? '<?xml version="1.0" encoding="UTF-8"?>\n' : ''}<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${vx} ${vy} ${width} ${height}" font-family="${escapeXml(FONT)}">
  <defs>
    <marker id="clara-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="${pal.connector}" />
    </marker>
  </defs>
${background ? `  <rect x="${vx}" y="${vy}" width="${width}" height="${height}" fill="${color(background, '#ffffff')}" />\n` : ''}  ${parts.join('\n  ')}
</svg>`;
  return { svg, width, height };
}
