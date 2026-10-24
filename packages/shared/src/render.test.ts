import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMermaid, parseClaraDsl, toMermaid, layoutToElements, type DiagramElement } from './dsl.js';
import { connectorSegment, diagramBounds, renderDiagramSvg, visibleElements } from './render.js';

const rect = (id: string, x: number, y: number, text = id, extra: Partial<DiagramElement> = {}): DiagramElement => ({
  id, type: 'rect', geometry: { x, y, width: 100, height: 50, text }, style: {}, zIndex: 1, ...extra,
});
const attached = (id: string, fromId: string, toId: string, text = ''): DiagramElement => ({
  id, type: 'connector', geometry: { fromId, toId, text }, style: {}, zIndex: 0,
});

test('toMermaid: canvas connectors (fromId/toId) become edges', () => {
  const els = [rect('a', 0, 0, 'Web'), rect('b', 0, 200, 'API'), attached('c', 'a', 'b', 'HTTPS')];
  assert.equal(toMermaid(els), 'flowchart TD\n  n0["Web"]\n  n1["API"]\n  n0 -->|HTTPS| n1');
});

test('toMermaid: attached connectors follow the reference, not the nearest shape', () => {
  // Stale coordinates point at b, but the connector is attached to c.
  const c: DiagramElement = { ...attached('k', 'a', 'c'), geometry: { fromId: 'a', toId: 'c', x1: 50, y1: 25, x2: 50, y2: 225 } };
  const out = toMermaid([rect('a', 0, 0), rect('b', 0, 200), rect('c', 400, 400), c]);
  assert.match(out, /n0 --> n2$/);
});

test('toMermaid: the old coordinate format still resolves to the nearest shapes', () => {
  const free: DiagramElement = { id: 'k', type: 'connector', geometry: { x1: 50, y1: 25, x2: 50, y2: 225, text: '' }, style: {}, zIndex: 0 };
  assert.match(toMermaid([rect('a', 0, 0), rect('b', 0, 200), free]), /n0 --> n1$/);
});

test('toMermaid: connectors to text/groups or to deleted shapes are skipped', () => {
  const text: DiagramElement = { id: 't', type: 'text', geometry: { x: 0, y: 0, text: 'note' }, style: {}, zIndex: 2 };
  const out = toMermaid([rect('a', 0, 0), text, attached('k1', 'a', 't'), attached('k2', 'a', 'gone')]);
  assert.doesNotMatch(out, /-->/);
});

test('toMermaid -> parseMermaid round-trips labels (no stray quotes) and ellipses', () => {
  const ell: DiagramElement = { id: 'e', type: 'ellipse', geometry: { x: 0, y: 200, width: 100, height: 50, text: 'Say "hi"' }, style: {}, zIndex: 1 };
  const g = parseMermaid(toMermaid([rect('a', 0, 0, 'Web [edge]'), ell, attached('k', 'a', 'e', 'calls')]));
  assert.deepEqual(g.nodes.map((n) => n.label), ['Web edge', "Say 'hi'"]);
  assert.deepEqual(g.edges, [{ from: 'n0', to: 'n1', label: 'calls' }]);
});

test('parseMermaid: strips quotes and stadium wrappers from labels', () => {
  const g = parseMermaid('A["Quoted"] --> B(["Stadium"])');
  assert.deepEqual(g.nodes.map((n) => n.label), ['Quoted', 'Stadium']);
});

test('connectorSegment: attached connectors are clipped to the shape outlines', () => {
  const els = [rect('a', 0, 0), rect('b', 0, 200), attached('k', 'a', 'b')];
  const byId = new Map(els.map((e) => [e.id!, e]));
  assert.deepEqual(connectorSegment(els[2], byId), { x1: 50, y1: 50, x2: 50, y2: 200 });
});

test('connectorSegment: dangling refs fall back to coordinates, or nothing', () => {
  const byId = new Map<string, DiagramElement>();
  const withCoords: DiagramElement = { ...attached('k', 'x', 'y'), geometry: { fromId: 'x', toId: 'y', x1: 1, y1: 2, x2: 3, y2: 4 } };
  assert.deepEqual(connectorSegment(withCoords, byId), { x1: 1, y1: 2, x2: 3, y2: 4 });
  assert.equal(connectorSegment(attached('k', 'x', 'y'), byId), undefined);
});

test('visibleElements: a hidden endpoint hides its connector', () => {
  const els = [rect('a', 0, 0), { ...rect('b', 0, 200), hidden: true }, attached('k', 'a', 'b')];
  assert.deepEqual(visibleElements(els).map((e) => e.id), ['a']);
});

test('renderDiagramSvg: draws attached connectors and skips base-hidden elements', () => {
  const els = [rect('a', 0, 0, 'A&B'), rect('b', 0, 200), rect('s', 300, 0, 'state-only', { style: { baseHidden: true } }), attached('k', 'a', 'b', 'x<y')];
  const { svg, width, height } = renderDiagramSvg(els, { padding: 10 });
  assert.match(svg, /<line x1="50" y1="50" x2="50" y2="200"/);
  assert.match(svg, /A&amp;B/);
  assert.match(svg, /x&lt;y/);
  assert.doesNotMatch(svg, /state-only/);
  assert.equal(width, 120);
  assert.equal(height, 270);
});

test('renderDiagramSvg: attribute values cannot break out of the colour slot', () => {
  const evil = rect('a', 0, 0, 'x', { style: { fill: '"><script>alert(1)</script>' } });
  const { svg } = renderDiagramSvg([evil]);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /fill="#ffffff"/);
});

test('diagramBounds covers importer output', () => {
  const els = layoutToElements(parseMermaid('A --> B'));
  const b = diagramBounds(els)!;
  assert.ok(b.width >= 140 && b.height > 60);
});

test('parseMermaid: standalone node declarations keep their labels and isolated nodes', () => {
  const g = parseMermaid('flowchart TD\n  n0["Web"]\n  n1["Lonely"]\n  n2 --> n0');
  assert.deepEqual(g.nodes.map((n) => [n.id, n.label]), [['n0', 'Web'], ['n1', 'Lonely'], ['n2', 'n2']]);
  assert.equal(g.edges.length, 1);
});

test('layout direction: mermaid header and DSL directive', () => {
  assert.equal(parseMermaid('flowchart LR\nA --> B').direction, 'LR');
  assert.equal(parseMermaid('graph TD; A-->B').direction, 'TB');
  const lr = layoutToElements(parseMermaid('flowchart LR\nA --> B'));
  const [a, b] = lr.filter((e) => e.type === 'rect');
  assert.ok(Number(b.geometry.x) > Number(a.geometry.x) && a.geometry.y === b.geometry.y);
});

test('renderDiagramSvg: data attributes and highlights', () => {
  const els = [rect('a', 0, 0, 'A', { linkedDiagramId: 'child' })];
  const { svg } = renderDiagramSvg(els, { dataAttributes: true, highlights: { a: '#f59e0b' } });
  assert.match(svg, /<g data-el-id="a" data-link="child"/);
  assert.match(svg, /stroke="#f59e0b" stroke-width="2" stroke-dasharray/);
});

test('clara DSL direction directive', () => {
  assert.equal(parseClaraDsl('direction LR\nnode a').direction, 'LR');
  assert.equal(parseClaraDsl('node a').direction, undefined);
});

test('layoutToElements attaches connectors to their shapes (and keeps coordinates)', () => {
  const els = layoutToElements(parseClaraDsl('node a "A"\nnode b "B"\nedge a -> b "x"'));
  const [a, b] = els.filter((e) => e.type === 'rect');
  const c = els.find((e) => e.type === 'connector')!;
  assert.equal(c.geometry.fromId, a.id);
  assert.equal(c.geometry.toId, b.id);
  assert.equal(typeof c.geometry.x1, 'number');
  assert.match(toMermaid(els), /n0 -->\|x\| n1/);
});

test('parser diagnostics report skipped lines and unknown edge endpoints', () => {
  const issues: { line: number; message: string }[] = [];
  parseClaraDsl('node a\nnodee b\nedge a -> zz', issues);
  assert.deepEqual(issues.map((i) => i.line), [2, 3]);
  assert.match(issues[1].message, /"zz"/);

  const mi: { line: number; message: string }[] = [];
  parseMermaid('flowchart TD\n  A --> B\n  subgraph X\n  A === B', mi);
  assert.deepEqual(mi.map((i) => i.line), [3, 4]);
  assert.match(mi[0].message, /not supported/);
});

test('onboarding sample diagram parses cleanly and the welcome doc embeds it', async () => {
  const { SAMPLE_DIAGRAM_DSL, welcomeMarkdown } = await import('./onboarding.js');
  const issues: { line: number; message: string }[] = [];
  const g = parseClaraDsl(SAMPLE_DIAGRAM_DSL, issues);
  assert.equal(issues.length, 0);
  assert.equal(g.nodes.length, 6);
  assert.match(welcomeMarkdown('abc'), /```clara-diagram\nid: abc\n/);
  assert.doesNotMatch(welcomeMarkdown(), /clara-diagram/);
});

test('parseMermaid: other diagram types are refused, not read as nodes', () => {
  const issues: { line: number; message: string }[] = [];
  const g = parseMermaid('sequenceDiagram\n A->>B: hi', issues);
  assert.equal(g.nodes.length, 0);
  assert.match(issues[0].message, /Only flowcharts/);
  assert.equal(parseMermaid('%% c\nclassDiagram\nA <|-- B').nodes.length, 0);
});
