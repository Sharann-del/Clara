import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDiagramSvg, type DiagramElementRow } from './svg-export.js';

const row = (id: string, extra: Partial<DiagramElementRow>): DiagramElementRow => ({
  id,
  type: 'rect',
  geometry: {},
  style: {},
  z_index: 0,
  ...extra,
});

test('server SVG export draws connectors stored as fromId/toId (snake_case rows)', () => {
  const svg = renderDiagramSvg([
    row('a', { geometry: { x: 0, y: 0, width: 100, height: 50, text: 'Web' }, z_index: 1 }),
    row('b', { geometry: { x: 0, y: 200, width: 100, height: 50, text: 'API' }, z_index: 1 }),
    row('c', { type: 'connector', geometry: { fromId: 'a', toId: 'b' } }),
  ]);
  assert.match(svg, /^<\?xml/);
  assert.match(svg, /<line x1="50" y1="50" x2="50" y2="200"/);
});

test('server SVG export still draws legacy coordinate connectors', () => {
  const svg = renderDiagramSvg([row('c', { type: 'connector', geometry: { x1: 0, y1: 0, x2: 10, y2: 10 } })]);
  assert.match(svg, /<line x1="0" y1="0" x2="10" y2="10"/);
});
