import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapLabel } from './text.js';
import { layoutToElements, parseClaraDsl } from './dsl.js';
import { renderDiagramSvg } from './render.js';

const LONG = 'API Gateway HTTP API (default route + ANY /mcp)';

test('short labels stay on one line at full size', () => {
  assert.deepEqual(wrapLabel('Orders DB', 140, 60), { lines: ['Orders DB'], fontSize: 13, lineHeight: 16.25 });
});

test('long labels wrap on word boundaries and every line fits the box', () => {
  const w = wrapLabel(LONG, 180, 70);
  assert.ok(w.lines.length > 1);
  assert.equal(w.lines.join(' '), LONG);
  for (const line of w.lines) assert.ok(line.length * w.fontSize * 0.56 <= 180 - 16);
  assert.ok(w.lines.length * w.lineHeight <= 70 - 10);
});

test('text that cannot fit shrinks, then ends in an ellipsis', () => {
  const w = wrapLabel(LONG.repeat(4), 120, 40);
  assert.equal(w.fontSize, 9);
  assert.ok(w.lines.at(-1)!.endsWith('…'));
});

test('a word longer than the box is broken rather than overflowing', () => {
  const w = wrapLabel('arn:aws:secretsmanager:eu-north-1:rds-credentials', 120, 80);
  for (const line of w.lines) assert.ok(line.length * w.fontSize * 0.56 <= 120 - 16);
});

test('DSL layout grows boxes for long labels and the SVG draws one tspan per line', () => {
  const els = layoutToElements(parseClaraDsl(`node a "${LONG}"`));
  const box = els[0].geometry as { width: number; height: number };
  assert.ok(box.width > 140);
  const lines = wrapLabel(LONG, box.width, box.height).lines.length;
  assert.equal((renderDiagramSvg(els).svg.match(/<tspan /g) ?? []).length, lines);
});
