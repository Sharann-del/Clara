import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaraDsl, parseMermaid } from '@clara/shared/dsl';
import { EXAMPLES } from './examples';
import { detectFormat } from './share';

for (const ex of EXAMPLES) {
  test(`example "${ex.title}" parses and its format is detected`, () => {
    const g = ex.format === 'mermaid' ? parseMermaid(ex.code) : parseClaraDsl(ex.code);
    assert.ok(g.nodes.length >= 3, `${g.nodes.length} nodes`);
    assert.ok(g.edges.length >= 2);
    assert.equal(detectFormat(ex.code), ex.format);
  });
}
