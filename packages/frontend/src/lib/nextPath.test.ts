import test from 'node:test';
import assert from 'node:assert/strict';
import { safeNext } from './nextPath';

test('safeNext only allows same-site paths', () => {
  assert.equal(safeNext('/diagrams/1?x=1#h'), '/diagrams/1?x=1#h');
  assert.equal(safeNext('//evil.com'), '/app');
  assert.equal(safeNext('/\\evil.com'), '/app');
  assert.equal(safeNext('https://evil.com'), '/app');
  assert.equal(safeNext(null), '/app');
});
