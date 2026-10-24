import test from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay } from './backoff';

test('backoff grows exponentially and is capped at 30s', () => {
  const max = () => 1;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 10].map((a) => backoffDelay(a, max)), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

test('backoff never retries faster than 500ms, even with zero jitter', () => {
  assert.equal(backoffDelay(0, () => 0), 500);
  assert.equal(backoffDelay(8, () => 0), 500);
});
