/**
 * The JavaScript half of the iOS app's shared logic. Bundled by build-shared-js.sh into
 * Clara/Resources/clara-shared.js and evaluated in JavaScriptCore, so the iOS app parses the
 * Clara DSL / Mermaid, lays diagrams out, diffs proposals and tokenizes markdown with exactly
 * the code the web app and API use. Every function takes and returns JSON strings.
 */
import { diffLines } from 'diff';
import { Marked, type Token, type Tokens } from 'marked';
import { layoutToElements, parseClaraDsl, parseMermaid, toMermaid, type DiagramElement, type ParseIssue } from '../../packages/shared/src/dsl';
import { describeElement, diffElements } from '../../packages/shared/src/diff';
import { embedBlock, embeddedDiagrams, parseEmbed } from '../../packages/shared/src/embeds';
import { renderDiagramSvg } from '../../packages/shared/src/render';

function compile(code: string, format: string) {
  const issues: ParseIssue[] = [];
  const graph = format === 'mermaid' ? parseMermaid(code, issues) : parseClaraDsl(code, issues);
  return { elements: layoutToElements(graph), nodeCount: graph.nodes.length, edgeCount: graph.edges.length, issues };
}

// ---- markdown: marked's GFM lexer, flattened into a small AST the Swift renderer draws natively.

type Run = { t: 'text'; v: string; b?: 1; i?: 1; s?: 1; code?: 1; href?: string } | { t: 'image'; src: string; alt: string } | { t: 'br' };
type Block =
  | { t: 'heading'; depth: number; inline: Run[] }
  | { t: 'paragraph'; inline: Run[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'embed'; id: string; height?: number }
  | { t: 'list'; ordered: boolean; start: number; items: { task: boolean; checked: boolean; blocks: Block[] }[] }
  | { t: 'blockquote'; blocks: Block[] }
  | { t: 'table'; align: (string | null)[]; header: Run[][]; rows: Run[][][] }
  | { t: 'hr' }
  | { t: 'text'; v: string };

const safeHref = (href: string) => (/^(https?:|mailto:)/i.test(href) || /^[/#?.]/.test(href) || !/^[a-z][a-z0-9+.-]*:/i.test(href) ? href : undefined);

function inline(tokens: Token[] | undefined, style: { b?: 1; i?: 1; s?: 1; href?: string } = {}): Run[] {
  const out: Run[] = [];
  for (const tok of tokens ?? []) {
    switch (tok.type) {
      case 'strong':
        out.push(...inline((tok as Tokens.Strong).tokens, { ...style, b: 1 }));
        break;
      case 'em':
        out.push(...inline((tok as Tokens.Em).tokens, { ...style, i: 1 }));
        break;
      case 'del':
        out.push(...inline((tok as Tokens.Del).tokens, { ...style, s: 1 }));
        break;
      case 'link': {
        const l = tok as Tokens.Link;
        out.push(...inline(l.tokens, { ...style, href: safeHref(l.href) }));
        break;
      }
      case 'codespan':
        out.push({ t: 'text', v: (tok as Tokens.Codespan).text, code: 1, ...style });
        break;
      case 'image': {
        const im = tok as Tokens.Image;
        out.push({ t: 'image', src: im.href, alt: im.text ?? '' });
        break;
      }
      case 'br':
        out.push({ t: 'br' });
        break;
      case 'text': {
        const tx = tok as Tokens.Text;
        if (tx.tokens?.length) out.push(...inline(tx.tokens, style));
        else out.push({ t: 'text', v: decode(tx.text), ...style });
        break;
      }
      case 'escape':
        out.push({ t: 'text', v: (tok as Tokens.Escape).text, ...style });
        break;
      default:
        // Raw HTML and anything unknown is shown as text, never interpreted (docs can be public).
        out.push({ t: 'text', v: decode((tok as { raw: string }).raw), ...style });
    }
  }
  return out;
}

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function blocks(tokens: Token[]): Block[] {
  const out: Block[] = [];
  for (const tok of tokens) {
    switch (tok.type) {
      case 'heading': {
        const h = tok as Tokens.Heading;
        out.push({ t: 'heading', depth: h.depth, inline: inline(h.tokens) });
        break;
      }
      case 'paragraph':
        out.push({ t: 'paragraph', inline: inline((tok as Tokens.Paragraph).tokens) });
        break;
      case 'text': {
        const tx = tok as Tokens.Text;
        out.push({ t: 'paragraph', inline: tx.tokens?.length ? inline(tx.tokens) : [{ t: 'text', v: decode(tx.text) }] });
        break;
      }
      case 'code': {
        const c = tok as Tokens.Code;
        const ref = c.lang === 'clara-diagram' ? parseEmbed(c.text) : null;
        out.push(ref ? { t: 'embed', id: ref.id, height: ref.height } : { t: 'code', lang: (c.lang ?? '').split(/\s/)[0], text: c.text });
        break;
      }
      case 'list': {
        const l = tok as Tokens.List;
        out.push({
          t: 'list',
          ordered: l.ordered,
          start: typeof l.start === 'number' ? l.start : 1,
          items: l.items.map((it) => ({ task: it.task, checked: !!it.checked, blocks: blocks(it.tokens.filter((t) => t.type !== 'checkbox')) })),
        });
        break;
      }
      case 'blockquote':
        out.push({ t: 'blockquote', blocks: blocks((tok as Tokens.Blockquote).tokens) });
        break;
      case 'table': {
        const tb = tok as Tokens.Table;
        out.push({ t: 'table', align: tb.align, header: tb.header.map((c) => inline(c.tokens)), rows: tb.rows.map((r) => r.map((c) => inline(c.tokens))) });
        break;
      }
      case 'hr':
        out.push({ t: 'hr' });
        break;
      case 'space':
        break;
      default:
        out.push({ t: 'text', v: (tok as { raw: string }).raw });
    }
  }
  return out;
}

const marked = new Marked({ gfm: true, breaks: false });

const api = {
  compile: (code: string, format: string) => JSON.stringify(compile(code, format)),
  toMermaid: (elementsJson: string) => toMermaid(JSON.parse(elementsJson) as DiagramElement[]),
  diffElements: (currentJson: string, proposedJson: string) => JSON.stringify(diffElements(JSON.parse(currentJson), JSON.parse(proposedJson))),
  describeElement: (elJson: string) => describeElement(JSON.parse(elJson)),
  /** Line diff (the `diff` package, as the web review panel uses): [{ op: 'add'|'del'|'same', lines }]. */
  lineDiff: (before: string, after: string) =>
    JSON.stringify(diffLines(before ?? '', after ?? '').map((p) => ({ op: p.added ? 'add' : p.removed ? 'del' : 'same', lines: p.value.replace(/\n$/, '').split('\n') }))),
  markdown: (md: string) => JSON.stringify(blocks(marked.lexer(md ?? ''))),
  /** Standalone light-sheet SVG, identical to the web export. */
  renderSvg: (elementsJson: string) => renderDiagramSvg(JSON.parse(elementsJson), { xmlProlog: true }).svg,
  embedBlock: (id: string, height: number) => embedBlock({ id, height: height || undefined }),
  embeddedDiagrams: (md: string) => JSON.stringify(embeddedDiagrams(md)),
};

(globalThis as unknown as { Clara: typeof api }).Clara = api;
