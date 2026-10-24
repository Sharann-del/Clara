import test from 'node:test';
import assert from 'node:assert/strict';
import { timeAgo } from './time';

test('timeAgo', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  assert.equal(timeAgo('2026-10-24T11:59:50Z', now), 'just now');
  assert.match(timeAgo('2026-10-24T11:55:00Z', now), /5 minutes ago/);
  assert.match(timeAgo('2026-10-23T12:00:00Z', now), /yesterday|1 day ago/);
  assert.equal(timeAgo(null, now), '');
  assert.equal(timeAgo('garbage', now), '');
});
