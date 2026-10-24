import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { renderMarkdown } from '../lib/markdown';
import { DiagramEmbed } from './DiagramEmbed';

/** Finds embed placeholders inside `root` (after its HTML is set) so they can be filled with portals. */
export function useEmbedTargets(root: React.RefObject<HTMLElement>, deps: unknown[]) {
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  useLayoutEffect(() => {
    setTargets(root.current ? [...root.current.querySelectorAll<HTMLElement>('.md-embed')] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [targets, setTargets] as const;
}

export function EmbedPortals({ targets, publicToken }: { targets: HTMLElement[]; publicToken?: string }) {
  return (
    <>
      {targets.map((el, i) => {
        const id = el.getAttribute('data-diagram-id');
        const h = Number(el.getAttribute('data-height')) || undefined;
        return id ? createPortal(<DiagramEmbed id={id} height={h} publicToken={publicToken} />, el, `${id}-${i}`) : null;
      })}
    </>
  );
}

/** Rendered, read-only markdown with live diagram embeds. */
export function MarkdownView({ markdown, publicToken, className = '' }: { markdown: string; publicToken?: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  const ref = useRef<HTMLDivElement>(null);
  const [targets] = useEmbedTargets(ref, [html]);
  return (
    <>
      {/* Safe: renderMarkdown escapes raw HTML and filters URLs (see lib/markdown.ts). */}
      <div ref={ref} className={`prose ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
      <EmbedPortals targets={targets} publicToken={publicToken} />
    </>
  );
}
