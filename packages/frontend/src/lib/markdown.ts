import { Marked, type Tokens } from 'marked';

/**
 * Markdown -> HTML for Clara documents. Safe by construction (documents can be public):
 *  - raw HTML in the markdown is escaped and shown as text, never interpreted;
 *  - links only to http(s), mailto, relative and #anchors; images only http(s), relative or data:image;
 *  - ```clara-diagram blocks become embed placeholders that the React layer fills with a live diagram.
 */

import { embedBlock, embeddedDiagrams, parseEmbed, type DiagramEmbedRef } from '@clara/shared/embeds';

export { embedBlock, embeddedDiagrams, parseEmbed, type DiagramEmbedRef };

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const h = href.trim();
  if (/^(https?:|mailto:)/i.test(h) || /^[/#?.]/.test(h) || !/^[a-z][a-z0-9+.-]*:/i.test(h)) return h;
  return null;
}

export function safeImageSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  const s = src.trim();
  if (/^https?:/i.test(s) || /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(s) || /^[/.]/.test(s)) return s;
  return null;
}

const md = new Marked({ gfm: true, breaks: false });
md.use({
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      return esc(token.text);
    },
    link(token: Tokens.Link) {
      const href = safeHref(token.href);
      const text = this.parser.parseInline(token.tokens);
      if (!href) return text;
      const external = /^https?:/i.test(href);
      return `<a href="${esc(href)}"${token.title ? ` title="${esc(token.title)}"` : ''}${external ? ' target="_blank" rel="noopener noreferrer nofollow"' : ''}>${text}</a>`;
    },
    image(token: Tokens.Image) {
      const src = safeImageSrc(token.href);
      if (!src) return esc(token.text ?? '');
      return `<img src="${esc(src)}" alt="${esc(token.text ?? '')}"${token.title ? ` title="${esc(token.title)}"` : ''} loading="lazy">`;
    },
    code(token: Tokens.Code) {
      if (token.lang === 'clara-diagram') {
        const ref = parseEmbed(token.text);
        if (ref) {
          return `<div class="md-embed" contenteditable="false" data-diagram-id="${ref.id}"${ref.height ? ` data-height="${ref.height}"` : ''}></div>\n`;
        }
      }
      const lang = token.lang ? ` class="language-${esc(token.lang.split(/\s/)[0])}"` : '';
      return `<pre><code${lang}>${esc(token.text)}</code></pre>\n`;
    },
  },
});

export function renderMarkdown(markdown: string): string {
  return md.parse(markdown ?? '', { async: false }) as string;
}
