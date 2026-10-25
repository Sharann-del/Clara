import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMermaid, type DiagramElement } from './dsl.js';
import { diffElements } from './diff.js';
import { normalizeElement } from './elements.js';

test('mermaid: a bare later reference does not overwrite an earlier label', () => {
  const g = parseMermaid('flowchart TD\n  A[Web] --> B[API]\n  B -->|SQL| C[DB]');
  assert.deepEqual(g.nodes, [
    { id: 'A', label: 'Web' },
    { id: 'B', label: 'API' },
    { id: 'C', label: 'DB' },
  ]);
  assert.equal(g.edges[1].label, 'SQL');
});

test('mermaid: a later explicit label does replace a bare one', () => {
  const g = parseMermaid('A --> B\nB[Named] --> C');
  assert.equal(g.nodes.find((n) => n.id === 'B')?.label, 'Named');
});

test('mermaid: semicolons separate statements, including after the header', () => {
  const g = parseMermaid('graph LR; Browser-->CloudFront; CloudFront-->S3');
  assert.deepEqual(
    g.nodes.map((n) => n.id),
    ['Browser', 'CloudFront', 'S3'],
  );
  assert.deepEqual(
    g.edges.map((e) => [e.from, e.to]),
    [
      ['Browser', 'CloudFront'],
      ['CloudFront', 'S3'],
    ],
  );
});

test('mermaid: trailing semicolons and bare header are fine', () => {
  const g = parseMermaid('flowchart TD;\nA-->B;\n');
  assert.equal(g.edges.length, 1);
});

test('mermaid: mixed newlines and semicolons', () => {
  const g = parseMermaid('graph TD\n  A[Web] --> B[API]; B -->|SQL| C[DB]\n  C --> D;D --> E');
  assert.deepEqual(
    g.nodes.map((n) => n.label),
    ['Web', 'API', 'DB', 'D', 'E'],
  );
  assert.deepEqual(
    g.edges.map((e) => `${e.from}>${e.to}`),
    ['A>B', 'B>C', 'C>D', 'D>E'],
  );
  assert.equal(g.edges[1].label, 'SQL');
});

test('mermaid: a semicolon inside a label is not a separator; comments are ignored', () => {
  const g = parseMermaid('%% a; comment --> here\nA[one; two] --> B');
  assert.equal(g.nodes[0].label, 'one; two');
  assert.equal(g.edges.length, 1);
});

const el = (id: string, x: number, extra: Partial<DiagramElement> = {}): DiagramElement => ({
  id,
  type: 'rect',
  geometry: { x, y: 0 },
  style: {},
  zIndex: 0,
  ...extra,
});

test('diffElements classifies added / removed / changed and ignores key order', () => {
  const current = [el('a', 1), el('b', 2), { ...el('c', 3), geometry: { y: 0, x: 3 } }];
  const proposed = [el('a', 9), el('c', 3), el('d', 4)];
  const d = diffElements(current, proposed);
  assert.deepEqual(
    d.added.map((e) => e.id),
    ['d'],
  );
  assert.deepEqual(
    d.removed.map((e) => e.id),
    ['b'],
  );
  assert.deepEqual(
    d.changed.map((c) => [c.id, c.fields]),
    [['a', ['geometry']]],
  );
  assert.equal(d.unchangedCount, 1);
});

test('diffElements treats id-less proposed elements as added', () => {
  const d = diffElements([], [{ type: 'text', geometry: {}, style: {}, zIndex: 0 }]);
  assert.equal(d.added.length, 1);
});

test('normalizeElement maps a diagram_elements row so the drill-down link survives', () => {
  const row = {
    id: 'e1',
    diagram_id: 'd1',
    type: 'rect',
    geometry: { text: 'Lambda' },
    style: {},
    z_index: 3,
    linked_diagram_id: 'child-1',
    parent_group_id: null,
  };
  const el = normalizeElement(row);
  assert.equal(el.linkedDiagramId, 'child-1');
  assert.equal(el.zIndex, 3);
  assert.equal(el.parentGroupId, null);
});

test('normalizeElement is idempotent and tolerates the camelCase shape', () => {
  const once = normalizeElement({ id: 'e1', type: 'rect', linked_diagram_id: 'c', z_index: 2 });
  assert.deepEqual(normalizeElement(once), once);
  assert.equal(normalizeElement({ id: 'e2', type: 'text' }).linkedDiagramId, null);
});
