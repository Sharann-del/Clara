import { BadRequestError } from '../../api/src/lib/authz.js';
import type { DiagramElement } from '@clara/shared/dsl';

export interface ElementPatch {
  id: string;
  type?: DiagramElement['type'];
  /** Shallow-merged into the element's existing geometry (e.g. `{ x: 300 }` keeps y/width/height). */
  geometry?: Record<string, unknown>;
  /** Shallow-merged into the element's existing style. */
  style?: Record<string, unknown>;
  zIndex?: number;
  linkedDiagramId?: string | null;
  parentGroupId?: string | null;
}

export interface ElementOps {
  add?: DiagramElement[];
  update?: ElementPatch[];
  removeIds?: string[];
}

/**
 * Resolves granular element operations against the diagram's current elements into
 * the complete element list that will be staged for review. Unknown ids are an error
 * (not silently ignored) so Claude learns it referenced a stale or wrong element.
 */
export function applyElementOps(current: DiagramElement[], ops: ElementOps): DiagramElement[] {
  const byId = new Map(current.map((e) => [e.id as string, e]));
  const unknown = [...(ops.update ?? []).map((u) => u.id), ...(ops.removeIds ?? [])].filter((id) => !byId.has(id));
  if (unknown.length) throw new BadRequestError(`Unknown element id(s): ${[...new Set(unknown)].join(', ')}`);

  const removed = new Set(ops.removeIds ?? []);
  const patches = new Map((ops.update ?? []).map((u) => [u.id, u]));

  const next: DiagramElement[] = [];
  for (const el of current) {
    if (removed.has(el.id as string)) continue;
    const patch = patches.get(el.id as string);
    if (!patch) {
      next.push(el);
      continue;
    }
    next.push({
      ...el,
      type: patch.type ?? el.type,
      geometry: { ...el.geometry, ...patch.geometry },
      style: { ...el.style, ...patch.style },
      zIndex: patch.zIndex ?? el.zIndex,
      linkedDiagramId: 'linkedDiagramId' in patch ? patch.linkedDiagramId : el.linkedDiagramId,
      parentGroupId: 'parentGroupId' in patch ? patch.parentGroupId : el.parentGroupId,
    });
  }
  return [...next, ...(ops.add ?? [])];
}

/** Exact-match find/replace edits on a document body. Each `find` must occur exactly once. */
export function applyTextEdits(content: string, edits: { find: string; replace: string }[]): string {
  let out = content;
  edits.forEach((edit, i) => {
    if (!edit.find) throw new BadRequestError(`Edit ${i + 1}: "find" must not be empty`);
    const first = out.indexOf(edit.find);
    if (first === -1)
      throw new BadRequestError(
        `Edit ${i + 1}: text to replace was not found: ${JSON.stringify(edit.find.slice(0, 80))}`,
      );
    if (out.indexOf(edit.find, first + 1) !== -1) {
      throw new BadRequestError(
        `Edit ${i + 1}: text to replace appears more than once; include more surrounding context`,
      );
    }
    out = out.slice(0, first) + edit.replace + out.slice(first + edit.find.length);
  });
  return out;
}
