import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeState, detectFormat, encodeState } from './share';

test('share links round-trip code and format, including unicode', async () => {
  const state = { code: 'node a "Wëb ✓"\nedge a -> b', format: 'clara' as const };
  const hash = await encodeState(state);
  assert.match(hash, /^z=[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeState(`#${hash}`), state);
  assert.deepEqual(await decodeState(await encodeState({ code: 'graph LR; A-->B', format: 'mermaid' })), {
    code: 'graph LR; A-->B',
    format: 'mermaid',
  });
});

test('share links compress repetitive diagrams', async () => {
  const code = Array.from({ length: 200 }, (_, i) => `edge service${i} -> service${i + 1}`).join('\n');
  const hash = await encodeState({ code, format: 'clara' });
  assert.ok(hash.length < code.length / 3, `hash ${hash.length} vs code ${code.length}`);
});

test('decodeState rejects garbage and the plain variant works', async () => {
  assert.equal(await decodeState('#z=not-valid-deflate'), undefined);
  assert.equal(await decodeState('#x=abc'), undefined);
  assert.equal(await decodeState(''), undefined);
  const plain = Buffer.from(JSON.stringify({ c: 'node a', f: 'c' })).toString('base64url');
  assert.deepEqual(await decodeState(`t=${plain}`), { code: 'node a', format: 'clara' });
});

test('detectFormat', () => {
  assert.equal(detectFormat('%% comment\nflowchart TD\nA-->B'), 'mermaid');
  assert.equal(detectFormat('graph LR; A-->B'), 'mermaid');
  assert.equal(detectFormat('# nodes\nnode a'), 'clara');
});
