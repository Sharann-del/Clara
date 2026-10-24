import test from 'node:test';
import assert from 'node:assert/strict';
import { insertBlock, link, prefixLines, wrap } from './mdEdit';

test('wrap adds and removes markers', () => {
  const on = wrap({ value: 'say hi now', start: 4, end: 6 }, '**');
  assert.deepEqual(on, { value: 'say **hi** now', start: 6, end: 8 });
  assert.deepEqual(wrap(on, '**'), { value: 'say hi now', start: 4, end: 6 });
  assert.deepEqual(wrap({ value: '', start: 0, end: 0 }, '`'), { value: '`text`', start: 1, end: 5 });
});

test('prefixLines toggles on every touched line, and headings replace each other', () => {
  const v = 'a\nb\nc';
  const listed = prefixLines({ value: v, start: 0, end: 3 }, '- ');
  assert.equal(listed.value, '- a\n- b\nc');
  assert.equal(prefixLines(listed, '- ').value, 'a\nb\nc');
  assert.equal(prefixLines({ value: '## Title', start: 3, end: 3 }, '### ').value, '### Title');
  assert.equal(prefixLines({ value: 'x\ny', start: 0, end: 3 }, (i) => `${i + 1}. `).value, '1. x\n2. y');
});

test('insertBlock puts blocks on their own paragraph', () => {
  assert.equal(insertBlock({ value: 'para', start: 4, end: 4 }, '---').value, 'para\n\n---');
  assert.equal(insertBlock({ value: 'a\n\nb', start: 3, end: 3 }, 'X').value, 'a\n\nX\n\nb');
  const r = insertBlock({ value: '', start: 0, end: 0 }, '| A |', 'A');
  assert.equal(r.value.slice(r.start, r.end), 'A');
});

test('link selects the URL for typing', () => {
  const r = link({ value: 'see docs', start: 4, end: 8 });
  assert.equal(r.value, 'see [docs](https://)');
  assert.equal(r.value.slice(r.start, r.end), 'https://');
});
