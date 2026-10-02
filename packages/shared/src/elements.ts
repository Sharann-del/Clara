import type { DiagramElement } from './dsl.js';

/**
 * The single mapping between a diagram element as stored/returned (a `diagram_elements`
 * row: `linked_diagram_id`, `z_index`, `parent_group_id`) and the camelCase shape the
 * canvas, the REST write API and the MCP tools use (`linkedDiagramId`, `zIndex`, …).
 *
 * Accepts either shape. The drill-down link lives in exactly one place — the
 * `linked_diagram_id` column — and surfaces here as `linkedDiagramId`.
 */
export function normalizeElement(raw: Record<string, any>): DiagramElement & { id: string } {
  return {
    id: raw.id,
    type: raw.type,
    geometry: raw.geometry ?? {},
    style: raw.style ?? {},
    zIndex: raw.zIndex ?? raw.z_index ?? 0,
    linkedDiagramId: raw.linkedDiagramId ?? raw.linked_diagram_id ?? null,
    parentGroupId: raw.parentGroupId ?? raw.parent_group_id ?? null,
  };
}
