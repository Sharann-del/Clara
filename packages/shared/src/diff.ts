import type { DiagramElement } from './dsl.js';

export type ElementField = 'type' | 'geometry' | 'style' | 'zIndex' | 'linkedDiagramId' | 'parentGroupId';

export interface ChangedElement {
  id: string;
  before: DiagramElement;
  after: DiagramElement;
  /** Which top-level fields differ — the UI uses this to highlight what moved. */
  fields: ElementField[];
}

export interface ElementDiff {
  added: DiagramElement[];
  removed: DiagramElement[];
  changed: ChangedElement[];
  unchangedCount: number;
}

const FIELDS: ElementField[] = ['type', 'geometry', 'style', 'zIndex', 'linkedDiagramId', 'parentGroupId'];

/** Order-insensitive JSON, so `{a:1,b:2}` and `{b:2,a:1}` compare equal. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Matches elements by id: in proposed only = added, in current only = removed, in both but different = changed. */
export function diffElements(current: DiagramElement[], proposed: DiagramElement[]): ElementDiff {
  const before = new Map(current.filter((e) => e.id).map((e) => [e.id as string, e]));
  const seen = new Set<string>();
  const added: DiagramElement[] = [];
  const changed: ChangedElement[] = [];
  let unchangedCount = 0;

  for (const after of proposed) {
    const prior = after.id ? before.get(after.id) : undefined;
    if (!prior || !after.id) {
      added.push(after);
      continue;
    }
    seen.add(after.id);
    const fields = FIELDS.filter((f) => stable(prior[f]) !== stable(after[f]));
    if (fields.length > 0) changed.push({ id: after.id, before: prior, after, fields });
    else unchangedCount += 1;
  }

  const removed = current.filter((e) => e.id && !seen.has(e.id));
  return { added, removed, changed, unchangedCount };
}

/** Human label for an element in a diff list: its text if it has any, else its type. */
export function describeElement(el: DiagramElement): string {
  const text = typeof el.geometry?.text === 'string' ? el.geometry.text : '';
  return text ? `${el.type} "${text}"` : el.type;
}
