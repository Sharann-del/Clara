export interface DiagramElementRow {
  id: string;
  type: 'rect' | 'ellipse' | 'text' | 'connector' | 'group';
  geometry: Record<string, unknown>;
  style: Record<string, unknown>;
  z_index: number;
  [key: string]: unknown;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Minimal server-side mirror of the canvas element renderer — used for the
 * SVG export endpoint. Kept intentionally simple (matches the same
 * geometry/style JSON shape the frontend canvas writes); PNG/PDF export
 * happens client-side from the live canvas instead of being replicated here.
 */
export function renderDiagramSvg(allElements: DiagramElementRow[]): string {
  // Export is the Base view: skip elements that were drawn inside a state (and connectors to them).
  const hidden = new Set(allElements.filter((e) => e.style.baseHidden === true).map((e) => e.id));
  const elements = allElements.filter(
    (e) => !hidden.has(e.id) && !hidden.has(e.geometry.fromId as string) && !hidden.has(e.geometry.toId as string),
  );
  let maxX = 800;
  let maxY = 600;
  for (const el of elements) {
    const g = el.geometry;
    maxX = Math.max(maxX, num(g.x) + num(g.width), num(g.x1), num(g.x2));
    maxY = Math.max(maxY, num(g.y) + num(g.height), num(g.y1), num(g.y2));
  }
  const width = maxX + 40;
  const height = maxY + 40;

  const parts: string[] = [];
  const sorted = [...elements].sort((a, b) => a.z_index - b.z_index);
  for (const el of sorted) {
    const g = el.geometry;
    const s = el.style;
    const fill = str(s.fill, '#ffffff');
    const stroke = str(s.stroke, '#1f2937');
    const strokeWidth = num(s.strokeWidth, 1.5);

    if (el.type === 'rect') {
      parts.push(
        `<rect x="${num(g.x)}" y="${num(g.y)}" width="${num(g.width, 120)}" height="${num(g.height, 60)}" rx="${num(s.borderRadius, 4)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`,
      );
    } else if (el.type === 'ellipse') {
      const w = num(g.width, 120);
      const h = num(g.height, 60);
      parts.push(
        `<ellipse cx="${num(g.x) + w / 2}" cy="${num(g.y) + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`,
      );
    } else if (el.type === 'connector') {
      const x1 = num(g.x1);
      const y1 = num(g.y1);
      const x2 = num(g.x2);
      const y2 = num(g.y2);
      parts.push(
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${strokeWidth}" marker-end="url(#arrow)" />`,
      );
    } else if (el.type === 'text') {
      parts.push(
        `<text x="${num(g.x)}" y="${num(g.y) + num(s.fontSize, 14)}" font-size="${num(s.fontSize, 14)}" fill="${str(s.color, '#111827')}">${esc(str(g.text))}</text>`,
      );
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#1f2937" />
    </marker>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />
  ${parts.join('\n  ')}
</svg>`;
}
