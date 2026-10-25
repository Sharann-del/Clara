import dagre from 'dagre';
import { wrapLabel } from './text.js';

/** Canvas element as the API accepts it (PUT /diagrams/:id/elements). */
export interface DiagramElement {
  id?: string;
  type: 'rect' | 'ellipse' | 'text' | 'connector' | 'group';
  geometry: Record<string, unknown>;
  style: Record<string, unknown>;
  zIndex: number;
  linkedDiagramId?: string | null;
  parentGroupId?: string | null;
}

export interface DslNode {
  id: string;
  label: string;
}
export interface DslEdge {
  from: string;
  to: string;
  label?: string;
}
export interface DslGroup {
  id: string;
  label: string;
  memberIds: string[];
}
/** A line the parser skipped or a reference it could not resolve (1-based line numbers). */
export interface ParseIssue {
  line: number;
  message: string;
}

export type LayoutDirection = 'TB' | 'BT' | 'LR' | 'RL';

export interface DslGraph {
  nodes: DslNode[];
  edges: DslEdge[];
  groups: DslGroup[];
  /** Layout direction; top-to-bottom when omitted. */
  direction?: LayoutDirection;
}

/** `TD` is Mermaid's alias for top-down. */
function toDirection(raw: string | undefined): LayoutDirection | undefined {
  const d = raw?.toUpperCase();
  if (d === 'TD') return 'TB';
  return d === 'TB' || d === 'BT' || d === 'LR' || d === 'RL' ? d : undefined;
}

const NODE_W = 140;
const NODE_H = 60;

/**
 * Clara DSL — a small line-based grammar:
 *   node <id> ["Label"]
 *   edge <id> -> <id> ["Label"]
 *   group <id> "Label" { <id> <id> ... }
 *   direction TB|LR|BT|RL
 * Lines starting with # are comments.
 */
export function parseClaraDsl(text: string, issues?: ParseIssue[]): DslGraph {
  const nodes: DslNode[] = [];
  const edges: DslEdge[] = [];
  const groups: DslGroup[] = [];
  let direction: LayoutDirection | undefined;
  const edgeLines: number[] = [];

  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    let m = line.match(/^direction\s+(\w+)$/i);
    if (m) {
      direction = toDirection(m[1]) ?? direction;
      continue;
    }

    m = line.match(/^node\s+(\S+)(?:\s+"([^"]*)")?$/);
    if (m) {
      nodes.push({ id: m[1], label: m[2] ?? m[1] });
      continue;
    }

    m = line.match(/^edge\s+(\S+)\s*->\s*(\S+)(?:\s+"([^"]*)")?$/);
    if (m) {
      edges.push({ from: m[1], to: m[2], label: m[3] });
      edgeLines.push(index + 1);
      continue;
    }

    m = line.match(/^group\s+(\S+)\s+"([^"]*)"\s*\{([^}]*)\}$/);
    if (m) {
      groups.push({ id: m[1], label: m[2], memberIds: m[3].trim().split(/\s+/).filter(Boolean) });
      continue;
    }

    issues?.push({
      line: index + 1,
      message: `Not understood: "${line.length > 60 ? `${line.slice(0, 57)}...` : line}"`,
    });
  }

  if (issues) {
    const known = new Set(nodes.map((n) => n.id));
    edges.forEach((e, i) => {
      const missing = [e.from, e.to].filter((id) => !known.has(id));
      if (missing.length)
        issues.push({
          line: edgeLines[i],
          message: `Edge skipped: no node named ${missing.map((id) => `"${id}"`).join(' or ')}`,
        });
    });
    issues.sort((a, b) => a.line - b.line);
  }

  return { nodes, edges, groups, direction };
}

/** Lays out a parsed graph with Dagre and converts it into canvas elements. */
export function layoutToElements(graph: DslGraph): DiagramElement[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: graph.direction ?? 'TB', nodesep: 40, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  // Long labels get a wider box, and a taller one if they still wrap past two lines.
  const sizeOf = (label: string) => {
    const width = label.length > 28 ? NODE_W + 60 : NODE_W;
    const wrap = wrapLabel(label, width, Infinity);
    return { width, height: Math.max(NODE_H, Math.ceil(wrap.lines.length * wrap.lineHeight + 24)) };
  };
  const sizes = new Map(graph.nodes.map((n) => [n.id, sizeOf(n.label)]));
  for (const node of graph.nodes) {
    g.setNode(node.id, sizes.get(node.id)!);
  }
  for (const edge of graph.edges) {
    // Labelled edges reserve room for their text so it doesn't land on a neighbouring node.
    const label = edge.label ? { width: Math.min(160, edge.label.length * 6.5 + 12), height: 16, labelpos: 'c' } : {};
    if (g.hasNode(edge.from) && g.hasNode(edge.to)) g.setEdge(edge.from, edge.to, label);
  }

  dagre.layout(g);

  const elements: DiagramElement[] = [];
  const idByDslId = new Map<string, string>();

  for (const node of graph.nodes) {
    const pos = g.node(node.id);
    const elId = crypto.randomUUID();
    idByDslId.set(node.id, elId);
    elements.push({
      id: elId,
      type: 'rect',
      geometry: {
        x: pos.x - pos.width / 2,
        y: pos.y - pos.height / 2,
        width: pos.width,
        height: pos.height,
        text: node.label,
      },
      style: { fill: '#eff6ff', stroke: '#2563eb' },
      zIndex: 1,
    });
  }

  for (const edge of graph.edges) {
    const fromPos = g.node(edge.from);
    const toPos = g.node(edge.to);
    if (!fromPos || !toPos) continue;
    elements.push({
      id: crypto.randomUUID(),
      type: 'connector',
      // Attached by id so the arrow follows its shapes on the canvas; x1..y2 stay as a fallback for older readers.
      geometry: {
        fromId: idByDslId.get(edge.from),
        toId: idByDslId.get(edge.to),
        x1: fromPos.x,
        y1: fromPos.y,
        x2: toPos.x,
        y2: toPos.y,
        text: edge.label ?? '',
      },
      style: { stroke: '#475569' },
      zIndex: 0,
    });
  }

  for (const group of graph.groups) {
    const memberEls = group.memberIds.map((id) => idByDslId.get(id)).filter(Boolean) as string[];
    const positions = memberEls.map((id) => elements.find((e) => e.id === id)).filter(Boolean) as DiagramElement[];
    if (positions.length === 0) continue;
    const xs = positions.map((p) => Number(p.geometry.x));
    const ys = positions.map((p) => Number(p.geometry.y));
    const x2s = positions.map((p) => Number(p.geometry.x) + Number(p.geometry.width ?? 0));
    const y2s = positions.map((p) => Number(p.geometry.y) + Number(p.geometry.height ?? 0));
    const pad = 24;
    elements.unshift({
      id: crypto.randomUUID(),
      type: 'group',
      geometry: {
        x: Math.min(...xs) - pad,
        y: Math.min(...ys) - pad - 20,
        width: Math.max(...x2s) - Math.min(...xs) + pad * 2,
        height: Math.max(...y2s) - Math.min(...ys) + pad * 2 + 20,
        text: group.label,
      },
      style: { fill: 'none', stroke: '#94a3b8' },
      zIndex: 0,
    });
  }

  return elements;
}

/**
 * Mermaid statements end at a newline or a `;`. A `;` inside a label (`A[a;b]`, `A("x;y")`)
 * is part of the label, so only split when not within brackets or quotes. `%%` comment
 * lines are dropped whole.
 */
function splitStatements(text: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  for (const [index, rawLine] of text.split('\n').entries()) {
    if (rawLine.trim().startsWith('%%')) continue;
    let depth = 0;
    let quoted = false;
    let current = '';
    for (const ch of rawLine) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && (ch === '[' || ch === '(' || ch === '{')) depth += 1;
      else if (!quoted && (ch === ']' || ch === ')' || ch === '}')) depth = Math.max(0, depth - 1);
      if (ch === ';' && depth === 0 && !quoted) {
        out.push({ text: current, line: index + 1 });
        current = '';
      } else {
        current += ch;
      }
    }
    out.push({ text: current, line: index + 1 });
  }
  return out.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text);
}

/** `"Label"`, `[Label]` (stadium `([..])`) and `(Label)` (circle `((..))`) inner wrappers -> `Label`. */
function cleanLabel(label: string | undefined): string | undefined {
  if (label === undefined) return undefined;
  let out = label.trim();
  for (;;) {
    const m = out.match(/^\[(.*)\]$|^\((.*)\)$|^"(.*)"$/s);
    if (!m) break;
    out = (m[1] ?? m[2] ?? m[3]).trim();
  }
  return out;
}

const NON_FLOWCHART =
  /^(sequenceDiagram|classDiagram(-v2)?|stateDiagram(-v2)?|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4(Context|Container|Component|Dynamic|Deployment)|sankey(-beta)?|xychart(-beta)?|block(-beta)?|packet(-beta)?|kanban|architecture(-beta)?|radar(-beta)?)\b/;

/** Minimal Mermaid flowchart importer — supports `A[Label] --> B[Label]` and `A -->|label| B`. */
export function parseMermaid(text: string, issues?: ParseIssue[]): DslGraph {
  const nodes = new Map<string, string>();
  const edges: DslEdge[] = [];
  let direction: LayoutDirection | undefined;

  const nodeRef = /([A-Za-z0-9_]+)(?:\[([^\]]*)\]|\{([^}]*)\}|\(([^)]*)\))?/;

  const statements = splitStatements(text);
  // Other Mermaid diagram types: refuse the whole source rather than read their header as a node.
  const kind = statements[0]?.text.match(NON_FLOWCHART)?.[0];
  if (kind) {
    issues?.push({
      line: statements[0].line,
      message: `Only flowcharts are supported; "${kind}" diagrams can't be imported`,
    });
    return { nodes: [], edges: [], groups: [] };
  }

  for (const { text: line, line: lineNo } of statements) {
    const header = line.match(/^(?:flowchart|graph)\b\s*(\w+)?/i);
    if (header) {
      direction = toDirection(header[1]) ?? direction;
      continue;
    }

    // A bare reference (`B -->|x| C`) must not overwrite a label given earlier (`A --> B[Label]`).
    const declare = (id: string, label: string | undefined) => {
      if (label !== undefined || !nodes.has(id)) nodes.set(id, label ?? id);
    };

    // Standalone declaration: `A[Label]` (what toMermaid emits for every shape).
    const solo = line.match(new RegExp(`^${nodeRef.source}$`));
    if (solo && !/^(end|subgraph|classDef|class|style|linkStyle|click|direction)$/i.test(solo[1])) {
      declare(solo[1], cleanLabel(solo[2] ?? solo[3] ?? solo[4]));
      continue;
    }

    const m = line.match(new RegExp(`^${nodeRef.source}\\s*--[->]*>(?:\\|([^|]*)\\|)?\\s*${nodeRef.source}$`));
    if (!m) {
      const unsupported = /^(subgraph|end|classDef|class|style|linkStyle|click|direction)\b/i.test(line);
      issues?.push({
        line: lineNo,
        message: unsupported
          ? `Ignored: "${line.split(/\s/)[0]}" is not supported yet`
          : `Not understood: "${line.length > 60 ? `${line.slice(0, 57)}...` : line}"`,
      });
      continue;
    }

    const [, fromId, fromLbl1, fromLbl2, fromLbl3, edgeLabel, toId, toLbl1, toLbl2, toLbl3] = m;
    declare(fromId, cleanLabel(fromLbl1 ?? fromLbl2 ?? fromLbl3));
    declare(toId, cleanLabel(toLbl1 ?? toLbl2 ?? toLbl3));
    edges.push({ from: fromId, to: toId, label: edgeLabel });
  }

  return {
    nodes: [...nodes.entries()].map(([id, label]) => ({ id, label })),
    edges,
    groups: [],
    direction,
  };
}

/** Mermaid-safe label text: no quotes (they delimit the label) and no brackets/pipes. */
function mermaidLabel(text: string): string {
  return text
    .replace(/"/g, "'")
    .replace(/[[\]|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Serializes the current canvas elements as a Mermaid flowchart. Connectors drawn with the
 * canvas tool reference their shapes (`geometry.fromId/toId`); importer-made connectors only
 * carry coordinates and are matched to the nearest shape centre. Connectors that touch a
 * non-shape (text, group) have no Mermaid equivalent and are skipped.
 */
export function toMermaid(elements: DiagramElement[]): string {
  const shapeEls = elements.filter((e) => e.type === 'rect' || e.type === 'ellipse');
  const idMap = new Map<DiagramElement, string>();
  shapeEls.forEach((el, i) => idMap.set(el, `n${i}`));
  const byId = new Map(elements.filter((e) => e.id).map((e) => [e.id as string, e]));

  const lines = ['flowchart TD'];
  shapeEls.forEach((el, i) => {
    const label = mermaidLabel(String(el.geometry.text ?? '')) || `Node ${i + 1}`;
    lines.push(el.type === 'ellipse' ? `  ${idMap.get(el)}(["${label}"])` : `  ${idMap.get(el)}["${label}"]`);
  });

  for (const el of elements) {
    if (el.type !== 'connector') continue;
    const ends = resolveConnectorShapes(el, byId, shapeEls);
    if (!ends) continue;
    const text = mermaidLabel(String(el.geometry.text ?? ''));
    lines.push(`  ${idMap.get(ends.from)} -->${text ? `|${text}|` : ''} ${idMap.get(ends.to)}`);
  }

  return lines.join('\n');
}

/** The two shapes a connector joins: by reference when it has one, else by nearest centre. */
export function resolveConnectorShapes(
  el: DiagramElement,
  byId: Map<string, DiagramElement>,
  shapes: DiagramElement[],
): { from: DiagramElement; to: DiagramElement } | undefined {
  const { fromId, toId } = el.geometry;
  if (typeof fromId === 'string' || typeof toId === 'string') {
    const from = typeof fromId === 'string' ? byId.get(fromId) : undefined;
    const to = typeof toId === 'string' ? byId.get(toId) : undefined;
    if (from && to) {
      return shapes.includes(from) && shapes.includes(to) ? { from, to } : undefined;
    }
    // Dangling reference (endpoint deleted): fall through to coordinates if it has them.
  }
  const coords = [el.geometry.x1, el.geometry.y1, el.geometry.x2, el.geometry.y2];
  if (!coords.every((v) => typeof v === 'number' && Number.isFinite(v))) return undefined;
  const from = findNearestShape(shapes, Number(el.geometry.x1), Number(el.geometry.y1));
  const to = findNearestShape(shapes, Number(el.geometry.x2), Number(el.geometry.y2));
  return from && to ? { from, to } : undefined;
}

function findNearestShape(shapes: DiagramElement[], x: number, y: number): DiagramElement | undefined {
  let best: DiagramElement | undefined;
  let bestDist = Infinity;
  for (const s of shapes) {
    const cx = Number(s.geometry.x) + Number(s.geometry.width ?? 0) / 2;
    const cy = Number(s.geometry.y) + Number(s.geometry.height ?? 0) / 2;
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}
