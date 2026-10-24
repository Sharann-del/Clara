import test from 'node:test';
import assert from 'node:assert/strict';
import { jpegToPdf } from './pdf';

const decoder = new TextDecoder('latin1');

test('jpegToPdf writes a structurally valid single-page PDF', () => {
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const pdf = jpegToPdf(fakeJpeg, 200, 100, 150, 75);
  const text = decoder.decode(pdf);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/MediaBox \[0 0 150 75\]/);
  assert.match(text, /\/Width 200 \/Height 100 .*\/Length 7 >>/);

  // Every xref offset must point at the start of its "n 0 obj" line.
  const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
  assert.ok(text.slice(startxref).startsWith('xref'));
  const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.equal(offsets.length, 5);
  offsets.forEach((off, i) => assert.ok(text.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1} offset`));
});
