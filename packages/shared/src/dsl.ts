import dagre from 'dagre';

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
export interface DslGraph {
  nodes: DslNode[];
  edges: DslEdge[];
  groups: DslGroup[];
}

const NODE_W = 140;
const NODE_H = 60;

/**
 * Clara DSL — a small line-based grammar:
 *   node <id> ["Label"]
 *   edge <id> -> <id> ["Label"]
 *   group <id> "Label" { <id> <id> ... }
 * Lines starting with # are comments.
 */
export function parseClaraDsl(text: string): DslGraph {
  const nodes: DslNode[] = [];
  const edges: DslEdge[] = [];
  const groups: DslGroup[] = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    let m = line.match(/^node\s+(\S+)(?:\s+"([^"]*)")?$/);
    if (m) {
      nodes.push({ id: m[1], label: m[2] ?? m[1] });
      continue;
    }

    m = line.match(/^edge\s+(\S+)\s*->\s*(\S+)(?:\s+"([^"]*)")?$/);
    if (m) {
      edges.push({ from: m[1], to: m[2], label: m[3] });
      continue;
    }

    m = line.match(/^group\s+(\S+)\s+"([^"]*)"\s*\{([^}]*)\}$/);
    if (m) {
      groups.push({ id: m[1], label: m[2], memberIds: m[3].trim().split(/\s+/).filter(Boolean) });
      continue;
    }
  }

  return { nodes, edges, groups };
}

/** Lays out a parsed graph with Dagre and converts it into canvas elements. */
export function layoutToElements(graph: DslGraph): DiagramElement[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    g.setNode(node.id, { width: NODE_W, height: NODE_H });
  }
  for (const edge of graph.edges) {
    if (g.hasNode(edge.from) && g.hasNode(edge.to)) g.setEdge(edge.from, edge.to);
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
      geometry: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2, width: NODE_W, height: NODE_H, text: node.label },
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
      geometry: { x1: fromPos.x, y1: fromPos.y, x2: toPos.x, y2: toPos.y, text: edge.label ?? '' },
      style: { stroke: '#475569' },
      zIndex: 0,
    });
  }

  for (const group of graph.groups) {
    const memberEls = group.memberIds.map((id) => idByDslId.get(id)).filter(Boolean) as string[];
    const positions = memberEls
      .map((id) => elements.find((e) => e.id === id))
      .filter(Boolean) as DiagramElement[];
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
function splitStatements(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine.trim().startsWith('%%')) continue;
    let depth = 0;
    let quoted = false;
    let current = '';
    for (const ch of rawLine) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && (ch === '[' || ch === '(' || ch === '{')) depth += 1;
      else if (!quoted && (ch === ']' || ch === ')' || ch === '}')) depth = Math.max(0, depth - 1);
      if (ch === ';' && depth === 0 && !quoted) {
        out.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    out.push(current);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Minimal Mermaid flowchart importer — supports `A[Label] --> B[Label]` and `A -->|label| B`. */
export function parseMermaid(text: string): DslGraph {
  const nodes = new Map<string, string>();
  const edges: DslEdge[] = [];

  const nodeRef = /([A-Za-z0-9_]+)(?:\[([^\]]*)\]|\{([^}]*)\}|\(([^)]*)\))?/;

  for (const line of splitStatements(text)) {
    if (/^(flowchart|graph)\b/i.test(line)) continue;

    const m = line.match(
      new RegExp(`^${nodeRef.source}\\s*--[->]*>(?:\\|([^|]*)\\|)?\\s*${nodeRef.source}$`),
    );
    if (!m) continue;

    const [, fromId, fromLbl1, fromLbl2, fromLbl3, edgeLabel, toId, toLbl1, toLbl2, toLbl3] = m;
    // A bare reference (`B -->|x| C`) must not overwrite a label given earlier (`A --> B[Label]`).
    const declare = (id: string, label: string | undefined) => {
      if (label !== undefined || !nodes.has(id)) nodes.set(id, label ?? id);
    };
    declare(fromId, fromLbl1 ?? fromLbl2 ?? fromLbl3);
    declare(toId, toLbl1 ?? toLbl2 ?? toLbl3);
    edges.push({ from: fromId, to: toId, label: edgeLabel });
  }

  return {
    nodes: [...nodes.entries()].map(([id, label]) => ({ id, label })),
    edges,
    groups: [],
  };
}

/** Serializes the current canvas elements as a Mermaid flowchart. */
export function toMermaid(elements: DiagramElement[]): string {
  const idMap = new Map<string, string>();
  let counter = 0;
  const shapeEls = elements.filter((e) => e.type === 'rect' || e.type === 'ellipse');
  for (const el of shapeEls) {
    idMap.set(el.id ?? String(counter), `n${counter}`);
    counter += 1;
  }

  const lines = ['flowchart TD'];
  shapeEls.forEach((el, i) => {
    const label = String(el.geometry.text ?? `Node ${i + 1}`).replace(/[[\]]/g, '');
    lines.push(`  ${idMap.get(el.id ?? String(i))}["${label}"]`);
  });

  for (const el of elements) {
    if (el.type !== 'connector') continue;
    // Connectors are stored by geometry, not element refs, so match by nearest shape center.
    const from = findNearestShape(shapeEls, Number(el.geometry.x1), Number(el.geometry.y1));
    const to = findNearestShape(shapeEls, Number(el.geometry.x2), Number(el.geometry.y2));
    if (!from || !to) continue;
    const label = el.geometry.text ? `|${el.geometry.text}|` : '';
    lines.push(`  ${idMap.get(from.id ?? '')} -->${label} ${idMap.get(to.id ?? '')}`);
  }

  return lines.join('\n');
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
