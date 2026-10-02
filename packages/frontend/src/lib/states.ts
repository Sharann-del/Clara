import type { DiagramElement, DiagramState, ElementOverride } from './api';

/** A diagram element with a state's overrides applied. `hidden` elements are kept so callers can ghost or fade them. */
export type ResolvedElement = DiagramElement & { hidden?: boolean };

const num = (v: unknown, fallback = 0) => (typeof v === 'number' ? v : fallback);

/**
 * Elements drawn while a state is selected are stored as base rows flagged `style.baseHidden`:
 * hidden in Base and in every state unless that state's override says `hidden: false`.
 */
export const isBaseHidden = (el: DiagramElement) => el.style.baseHidden === true;

/** Applies one state's overrides (or none, for Base) onto the base elements. Overrides for elements that no longer exist are ignored. */
export function resolveElements(base: DiagramElement[], state: DiagramState | undefined): ResolvedElement[] {
  const ov = state?.element_overrides ?? {};
  const resolved: ResolvedElement[] = base.map((el) => {
    const o = el.id ? ov[el.id] : undefined;
    if (!o && !isBaseHidden(el)) return el;
    return {
      ...el,
      geometry: { ...el.geometry, ...o?.geometry },
      style: { ...el.style, ...o?.style },
      hidden: o?.hidden ?? isBaseHidden(el),
    };
  });
  // A connector can't outlive an endpoint it's attached to.
  const hiddenIds = new Set(resolved.filter((e) => e.hidden).map((e) => e.id));
  return resolved.map((el) =>
    el.type === 'connector' &&
    (hiddenIds.has(el.geometry.fromId as string) || hiddenIds.has(el.geometry.toId as string))
      ? { ...el, hidden: true }
      : el,
  );
}

/**
 * What to persist when an element is created. With no state selected it's a plain base element;
 * inside a state it is flagged base-hidden and made visible only in that state.
 */
export function planCreate(el: DiagramElement, activeStateId: string | null) {
  if (!activeStateId) return { element: el, override: null };
  return {
    element: { ...el, style: { ...el.style, baseHidden: true } },
    override: { stateId: activeStateId, elementId: el.id!, value: { hidden: false } as ElementOverride },
  };
}

/** Only the keys of `patch` whose values differ from `base` — overrides stay minimal. */
function diffKeys(base: Record<string, unknown>, patch: Record<string, unknown> | undefined) {
  if (!patch) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (JSON.stringify(base[k]) !== JSON.stringify(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Merges an edit made while a state is selected into that element's existing override.
 * Returns null when the result equals the base element (i.e. the override can be cleared).
 */
export function mergeOverride(
  base: DiagramElement,
  existing: ElementOverride | undefined,
  patch: { geometry?: Record<string, unknown>; style?: Record<string, unknown>; hidden?: boolean },
): ElementOverride | null {
  const next: ElementOverride = { ...existing };
  if (patch.geometry) {
    const d = diffKeys(base.geometry, { ...existing?.geometry, ...patch.geometry });
    // Keys the patch explicitly reverted to base drop out of the diff above; keys it didn't touch persist.
    if (d) next.geometry = d;
    else delete next.geometry;
  }
  if (patch.style) {
    const d = diffKeys(base.style, { ...existing?.style, ...patch.style });
    if (d) next.style = d;
    else delete next.style;
  }
  if (patch.hidden !== undefined) {
    // Only store visibility when it differs from the element's default (base-hidden or not).
    if (patch.hidden === isBaseHidden(base)) delete next.hidden;
    else next.hidden = patch.hidden;
  }
  return Object.keys(next).length ? next : null;
}

// ---- Present mode steps ----

export interface PresentStep {
  name: string;
  /** undefined = Base (no overrides). */
  state: DiagramState | undefined;
}

/** Walkthrough order: Base first, then each named state in order. */
export const buildSteps = (states: DiagramState[]): PresentStep[] => [
  { name: 'Base', state: undefined },
  ...states.map((state) => ({ name: state.name, state })),
];

/** Step index to start on for the currently selected state (null = Base). */
export const startStepIndex = (states: DiagramState[], activeStateId: string | null) =>
  activeStateId ? Math.max(0, states.findIndex((s) => s.id === activeStateId) + 1) : 0;

/** Moves one step, staying in range (Prev on the first step / Next on the last does nothing). */
export const stepBy = (index: number, dir: -1 | 1, count: number) => Math.min(count - 1, Math.max(0, index + dir));

// ---- Present-mode interpolation ----

export interface RenderEl {
  el: DiagramElement;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  fill?: string;
  stroke?: string;
}

export function toRender(el: ResolvedElement): RenderEl {
  return {
    el,
    x: num(el.geometry.x),
    y: num(el.geometry.y),
    width: num(el.geometry.width, 120),
    height: num(el.geometry.height, 60),
    opacity: el.hidden ? 0 : 1,
    fill: el.style.fill as string | undefined,
    stroke: el.style.stroke as string | undefined,
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function hex(c: string | undefined): [number, number, number] | null {
  if (!c || !/^#[0-9a-f]{6}$/i.test(c)) return null;
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
}

function lerpColor(a: string | undefined, b: string | undefined, t: number): string | undefined {
  const ca = hex(a);
  const cb = hex(b);
  if (!ca || !cb) return t < 0.5 ? a : b;
  return `rgb(${ca.map((v, i) => Math.round(lerp(v, cb[i], t))).join(',')})`;
}

export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Blends two resolved states (matched by element id) at progress t∈[0,1]. */
export function interpolate(from: RenderEl[], to: RenderEl[], t: number): RenderEl[] {
  const fromById = new Map(from.map((r) => [r.el.id, r]));
  return to.map((b) => {
    const a = fromById.get(b.el.id) ?? b;
    return {
      el: b.el,
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      width: lerp(a.width, b.width, t),
      height: lerp(a.height, b.height, t),
      opacity: lerp(a.opacity, b.opacity, t),
      fill: lerpColor(a.fill, b.fill, t),
      stroke: lerpColor(a.stroke, b.stroke, t),
    };
  });
}
