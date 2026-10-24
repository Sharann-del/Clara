import { normalizeElement } from '@clara/shared/elements';
import { renderDiagramSvg as renderSvg } from '@clara/shared/render';

export interface DiagramElementRow {
  id: string;
  type: 'rect' | 'ellipse' | 'text' | 'connector' | 'group';
  geometry: Record<string, unknown>;
  style: Record<string, unknown>;
  z_index: number;
  [key: string]: unknown;
}

/**
 * Server-side SVG export (GET /diagrams/:id/export). Uses the same renderer as the
 * client's SVG/PNG/PDF export (@clara/shared/render), so connectors attached by id
 * (`geometry.fromId/toId`) and free connectors (`x1..y2`) both draw. Export is the
 * Base view: elements drawn only inside a state (`style.baseHidden`) are skipped.
 */
export function renderDiagramSvg(rows: DiagramElementRow[]): string {
  return renderSvg(rows.map(normalizeElement), { xmlProlog: true }).svg;
}
