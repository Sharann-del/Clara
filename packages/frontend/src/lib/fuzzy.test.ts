import test from 'node:test';
import assert from 'node:assert/strict';
import { rankMatches, scoreMatch } from './fuzzy';

test('scoreMatch ordering', () => {
  assert.ok(scoreMatch('Orders', 'orders') > scoreMatch('Orders API', 'orders'));
  assert.ok(scoreMatch('Orders API', 'orders') > scoreMatch('My orders', 'orders'));
  assert.ok(scoreMatch('My orders', 'orders') > scoreMatch('Reorders', 'orders'));
  assert.ok(scoreMatch('Reorders', 'orders') > scoreMatch('o r d e r s x', 'orders'));
  assert.equal(scoreMatch('Payments', 'xyz'), 0);
  assert.equal(scoreMatch('a(b', '(b'), 40); // regex characters in the query must not throw
});

test('rankMatches matches tags and drops non-matches', () => {
  const items = [
    { name: 'Checkout flow', tags: ['payments'] },
    { name: 'Payments service', tags: [] },
    { name: 'Search', tags: [] },
  ];
  assert.deepEqual(rankMatches(items, 'pay', (i) => [i.name, ...i.tags]).map((i) => i.name), ['Checkout flow', 'Payments service']);
  assert.equal(rankMatches(items, '', (i) => [i.name]).length, 3);
});
