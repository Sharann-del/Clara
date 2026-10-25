/**
 * Diagram embeds in markdown documents:
 *
 *   ```clara-diagram
 *   id: <diagram uuid>
 *   height: 360        (optional, 120–1200 px)
 *   ```
 *
 * One parser for the web client (rendering) and the API (deciding which diagrams a public
 * document link may expose), so the two can never disagree.
 */
export interface DiagramEmbedRef {
  id: string;
  height?: number;
}

export function parseEmbed(body: string): DiagramEmbedRef | null {
  const id = body.match(/^\s*id:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/im)?.[1];
  if (!id) return null;
  const h = Number(body.match(/^\s*height:\s*(\d{2,4})\s*$/im)?.[1]);
  return { id: id.toLowerCase(), height: Number.isFinite(h) && h >= 120 && h <= 1200 ? h : undefined };
}

export const embedBlock = (ref: DiagramEmbedRef) =>
  `\`\`\`clara-diagram\nid: ${ref.id}${ref.height ? `\nheight: ${ref.height}` : ''}\n\`\`\``;

/** Every embed in a document, in order (duplicates kept). */
export function embeddedDiagrams(markdown: string): DiagramEmbedRef[] {
  const out: DiagramEmbedRef[] = [];
  for (const m of (markdown ?? '').matchAll(/```clara-diagram[^\n]*\n([\s\S]*?)```/gi)) {
    const ref = parseEmbed(m[1]);
    if (ref) out.push(ref);
  }
  return out;
}
