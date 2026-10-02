import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMermaid, type DiagramElement } from './dsl.js';
import { diffElements } from './diff.js';

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

const el = (id: string, x: number, extra: Partial<DiagramElement> = {}): DiagramElement => ({
  id, type: 'rect', geometry: { x, y: 0 }, style: {}, zIndex: 0, ...extra,
});

test('diffElements classifies added / removed / changed and ignores key order', () => {
  const current = [el('a', 1), el('b', 2), { ...el('c', 3), geometry: { y: 0, x: 3 } }];
  const proposed = [el('a', 9), el('c', 3), el('d', 4)];
  const d = diffElements(current, proposed);
  assert.deepEqual(d.added.map((e) => e.id), ['d']);
  assert.deepEqual(d.removed.map((e) => e.id), ['b']);
  assert.deepEqual(d.changed.map((c) => [c.id, c.fields]), [['a', ['geometry']]]);
  assert.equal(d.unchangedCount, 1);
});

test('diffElements treats id-less proposed elements as added', () => {
  const d = diffElements([], [{ type: 'text', geometry: {}, style: {}, zIndex: 0 }]);
  assert.equal(d.added.length, 1);
});
