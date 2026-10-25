// Exports the public site's content (docs, about, pricing, privacy, terms, playground examples)
// into ios/Clara/Resources/site-content.json, so the app shows exactly what the site says.
// Needs the web dev server running (npm run frontend:dev). Re-run after editing site pages.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(root, 'package.json'));
const { chromium } = require('@playwright/test');
const BASE = process.env.SITE ?? 'http://localhost:5173';
const tmp = mkdtempSync(join(tmpdir(), 'clara-site-'));
const esbuild = join(root, 'node_modules', '.bin', 'esbuild');

// The site's own HTML -> markdown rules, plus the About page's live diagram as a marker.
writeFileSync(join(tmp, 'md.ts'), `
import { turndown } from '${join(root, 'packages/frontend/src/lib/turndown.ts')}';
turndown.addRule('example-diagram', {
  filter: (n) => n.nodeName === 'DIV' && (n as HTMLElement).classList.contains('feature-visual'),
  replacement: () => '\\n\\n\\u0060\\u0060\\u0060clara-example\\nclara-aws\\n\\u0060\\u0060\\u0060\\n\\n',
});
(window as any).toMarkdown = (html: string) => turndown.turndown(html);
`);
execFileSync(esbuild, [join(tmp, 'md.ts'), '--bundle', '--format=iife', `--outfile=${join(tmp, 'md.js')}`, '--log-level=error']);
writeFileSync(join(tmp, 'ex.ts'), `import { EXAMPLES } from '${join(root, 'packages/frontend/src/lib/examples.ts')}'; console.log(JSON.stringify(EXAMPLES));`);
execFileSync(esbuild, [join(tmp, 'ex.ts'), '--bundle', '--platform=node', `--outfile=${join(tmp, 'ex.cjs')}`, '--log-level=error']);
const examples = JSON.parse(execFileSync('node', [join(tmp, 'ex.cjs')]).toString());

const browser = await chromium.launch();
const page = await browser.newPage();
async function open(path) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.addScriptTag({ path: join(tmp, 'md.js') });
}
const md = (selector) => page.$eval(selector, (el) => window.toMarkdown(el.innerHTML).trim());
const text = (selector) => page.$eval(selector, (el) => el.textContent.trim());

await open('/docs');
const sections = await page.$$eval('.docs-nav a', (as) => as.map((a) => ({ slug: a.getAttribute('href').split('/').pop(), title: a.textContent.trim() })));
const docs = [];
for (const s of sections) {
  await open(`/docs/${s.slug}`);
  const description = await page.$eval('.docs-body .lede', (el) => el.textContent.trim()).catch(() => '');
  // Body without the title, lede and pager (the app draws those natively).
  const markdown = await page.$eval('.docs-body', (el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll('h1, .lede, .docs-pager').forEach((n) => n.remove());
    return window.toMarkdown(c.innerHTML).trim();
  });
  docs.push({ ...s, description, markdown });
}

async function longformPage(path) {
  await open(path);
  return {
    title: await text('.page-intro h1'),
    subtitle: await page.$eval('.page-intro p', (el) => el.textContent.trim()).catch(() => ''),
    markdown: await page.$eval('.page', (el) => {
      const c = el.cloneNode(true);
      c.querySelector('.page-intro')?.remove();
      return window.toMarkdown(c.innerHTML).trim();
    }),
  };
}
const about = await longformPage('/about');
const privacy = await longformPage('/privacy');
const terms = await longformPage('/terms');

await open('/pricing');
const pricing = {
  title: await text('.page-intro h1'),
  subtitle: await text('.page-intro .lede'),
  plan: await text('.plan.featured h2'),
  price: await page.$eval('.plan-price', (el) => el.firstChild.textContent.trim()),
  per: await text('.plan-price small'),
  included: await page.$$eval('.plan.featured li', (ls) => ls.map((l) => l.textContent.trim())),
  laterTitle: await text('.plan:not(.featured) h2'),
  later: await page.$eval('.plan:not(.featured)', (el) => window.toMarkdown([...el.querySelectorAll('p')].map((p) => p.outerHTML).join('')).trim()),
  limitsTitle: await text('#limits-title'),
  limits: await page.$$eval('.limits-table tr', (rs) => rs.map((r) => [r.querySelector('th').textContent.trim(), r.querySelector('td').textContent.trim()])),
};
await browser.close();

const out = join(root, 'ios/Clara/Resources/site-content.json');
writeFileSync(out, JSON.stringify({ docs, about, privacy, terms, pricing, examples }, null, 1));
console.log(`wrote ${out}: ${docs.length} docs sections, ${examples.length} examples`);
