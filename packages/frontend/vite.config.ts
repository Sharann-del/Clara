import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Public, indexable routes. App routes (workspaces, documents, diagrams) are private and excluded. */
export const PUBLIC_ROUTES = [
  '/',
  '/editor',
  '/pricing',
  '/about',
  '/docs',
  '/docs/getting-started',
  '/docs/dsl',
  '/docs/mermaid',
  '/docs/mcp',
  '/docs/shortcuts',
  '/privacy',
  '/terms',
];

/** Emits robots.txt and sitemap.xml at build time from VITE_SITE_URL. */
function seoFiles(siteUrl: string): Plugin {
  return {
    name: 'clara-seo-files',
    apply: 'build',
    generateBundle() {
      const robots = [
        'User-agent: *',
        'Allow: /',
        'Disallow: /workspaces/',
        'Disallow: /documents/',
        'Disallow: /diagrams/',
        'Disallow: /settings/',
        'Disallow: /s/',
        ...(siteUrl ? ['', `Sitemap: ${siteUrl}/sitemap.xml`] : []),
        '',
      ].join('\n');
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots });
      if (!siteUrl) {
        this.warn('VITE_SITE_URL is not set: sitemap.xml skipped and Open Graph URLs are relative.');
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const urls = PUBLIC_ROUTES.map(
        (r) => `  <url><loc>${siteUrl}${r}</loc><lastmod>${today}</lastmod><priority>${r === '/' ? '1.0' : r === '/editor' ? '0.9' : '0.6'}</priority></url>`,
      ).join('\n');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      });
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const siteUrl = (env.VITE_SITE_URL ?? '').replace(/\/$/, '');
  // index.html uses %VITE_SITE_URL%; make sure it is always defined (empty = relative URLs).
  process.env.VITE_SITE_URL = siteUrl;
  return {
    plugins: [react(), seoFiles(siteUrl)],
    server: { port: 5173 },
    // amazon-cognito-identity-js references Node's `global`. The production build's CommonJS
    // transform rewrites it; the dev server's pre-bundle doesn't, so alias it there.
    define: command === 'serve' ? { global: 'globalThis' } : {},
  };
});
