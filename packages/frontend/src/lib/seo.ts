import { useEffect } from 'react';

const DEFAULT_DESCRIPTION =
  'Clara keeps system design docs and architecture diagrams in one place: markdown, diagram-as-code, C4 drill-down, live collaboration, and AI edits you review before they land.';

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/**
 * Per-page <title>, description and Open Graph title/description. Clara is a client-rendered SPA,
 * so crawlers that don't run JS see index.html's defaults; this keeps tabs, history and JS-capable
 * crawlers accurate. `noindex` for private app pages and share links.
 */
export function usePageMeta(title: string | undefined, opts: { description?: string; noindex?: boolean } = {}) {
  const description = opts.description ?? DEFAULT_DESCRIPTION;
  useEffect(() => {
    if (title === undefined) return;
    const full = title ? `${title} · Clara` : 'Clara · System design docs and diagrams as code';
    document.title = full;
    setMeta('name', 'description', description);
    setMeta('property', 'og:title', full);
    setMeta('property', 'og:description', description);
    setMeta('name', 'robots', opts.noindex ? 'noindex' : 'index,follow');
  }, [title, description, opts.noindex]);
}
