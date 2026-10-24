import TurndownService from 'turndown';
import { embedBlock } from './markdown';

/** Rich view (HTML) -> markdown, preserving diagram embeds and tables. */
export const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });

turndown.addRule('clara-diagram', {
  filter: (node) => node.nodeName === 'DIV' && (node as HTMLElement).classList.contains('md-embed'),
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const id = el.getAttribute('data-diagram-id') ?? '';
    const h = Number(el.getAttribute('data-height'));
    return `\n\n${embedBlock({ id, height: Number.isFinite(h) && h > 0 ? h : undefined })}\n\n`;
  },
});

const cell = (n: Node) => (turndown.turndown((n as HTMLElement).innerHTML || '').replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim() || ' ');

turndown.addRule('table', {
  filter: 'table',
  replacement: (_content, node) => {
    const rows = [...(node as HTMLTableElement).querySelectorAll('tr')].map((tr) => [...tr.children].map(cell));
    if (rows.length === 0) return '';
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => [...r, ...Array(width - r.length).fill(' ')];
    const [head, ...body] = rows.map(pad);
    return `\n\n| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n${body.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n\n`;
  },
});
