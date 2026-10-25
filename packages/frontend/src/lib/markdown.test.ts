import test from 'node:test';
import assert from 'node:assert/strict';
import { embedBlock, embeddedDiagrams, parseEmbed, renderMarkdown, safeHref } from './markdown';

const ID = '3f0c8f8e-5f0a-4a3b-9e57-0d7a2a1f1c42';

test('raw HTML is shown as text, not interpreted', () => {
  const html = renderMarkdown(
    'hello <img src=x onerror=alert(1)> <script>alert(2)</script>\n\n<div onclick="x">block</div>',
  );
  assert.doesNotMatch(html, /<img|<script|<div onclick/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('dangerous link and image URLs are dropped', () => {
  const html = renderMarkdown(
    '[a](javascript:alert(1)) [b](https://ok.example/x) ![c](javascript:x) ![d](https://img.example/p.png) [e](/docs)',
  );
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /<a href="https:\/\/ok\.example\/x" target="_blank" rel="noopener noreferrer nofollow">b<\/a>/);
  assert.match(html, /<img src="https:\/\/img\.example\/p\.png" alt="d"/);
  assert.match(html, /<a href="\/docs">e<\/a>/);
  assert.equal(safeHref('JaVaScRiPt:alert(1)'), null);
  assert.equal(safeHref('data:text/html,x'), null);
});

test('clara-diagram blocks become embed placeholders; others stay code', () => {
  const html = renderMarkdown(`${embedBlock({ id: ID, height: 300 })}\n\n\`\`\`js\nconst a = '<b>';\n\`\`\``);
  assert.match(
    html,
    new RegExp(`<div class="md-embed" contenteditable="false" data-diagram-id="${ID}" data-height="300"></div>`),
  );
  assert.match(html, /<pre><code class="language-js">const a = &#39;&lt;b&gt;&#39;;/);
});

test('embed parsing tolerates order and rejects junk', () => {
  assert.deepEqual(parseEmbed(`height: 400\nid: ${ID.toUpperCase()}`), { id: ID, height: 400 });
  assert.equal(parseEmbed('id: not-a-uuid'), null);
  assert.equal(parseEmbed(`id: ${ID}\nheight: 99999`)?.height, undefined);
  assert.deepEqual(embeddedDiagrams(`x\n${embedBlock({ id: ID })}\ny`), [{ id: ID, height: undefined }]);
});

test('tables (GFM) render', () => {
  assert.match(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |'), /<table>/);
});
