import test from 'node:test';
import assert from 'node:assert/strict';
import { applyElementOps, applyTextEdits } from './element-ops.js';
import type { DiagramElement } from '@clara/shared/dsl';

const el = (id: string, text: string, x = 0): DiagramElement => ({
  id,
  type: 'rect',
  geometry: { x, y: 0, width: 10, height: 10, text },
  style: { fill: '#fff' },
  zIndex: 1,
  linkedDiagramId: null,
  parentGroupId: null,
});

test('update shallow-merges geometry/style, remove drops, add appends', () => {
  const out = applyElementOps([el('a', 'A'), el('b', 'B')], {
    update: [{ id: 'a', geometry: { x: 99 }, style: { stroke: 'red' }, linkedDiagramId: 'child' }],
    removeIds: ['b'],
    add: [el('c', 'C')],
  });
  assert.deepEqual(out.map((e) => e.id), ['a', 'c']);
  assert.deepEqual(out[0].geometry, { x: 99, y: 0, width: 10, height: 10, text: 'A' });
  assert.deepEqual(out[0].style, { fill: '#fff', stroke: 'red' });
  assert.equal(out[0].linkedDiagramId, 'child');
});

test('omitted linkedDiagramId is preserved; explicit null clears it', () => {
  const linked = { ...el('a', 'A'), linkedDiagramId: 'child' };
  assert.equal(applyElementOps([linked], { update: [{ id: 'a', zIndex: 5 }] })[0].linkedDiagramId, 'child');
  assert.equal(applyElementOps([linked], { update: [{ id: 'a', linkedDiagramId: null }] })[0].linkedDiagramId, null);
});

test('unknown element ids are rejected', () => {
  assert.throws(() => applyElementOps([el('a', 'A')], { removeIds: ['nope'] }), /Unknown element id/);
  assert.throws(() => applyElementOps([el('a', 'A')], { update: [{ id: 'nope' }] }), /nope/);
});

test('text edits require exactly one match', () => {
  assert.equal(applyTextEdits('one two three', [{ find: 'two', replace: '2' }]), 'one 2 three');
  assert.throws(() => applyTextEdits('a a', [{ find: 'a', replace: 'b' }]), /more than once/);
  assert.throws(() => applyTextEdits('abc', [{ find: 'x', replace: 'y' }]), /not found/);
});
