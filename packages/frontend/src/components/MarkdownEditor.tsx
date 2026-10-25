import { useEffect, useRef, useState } from 'react';
import { renderMarkdown, embedBlock, safeHref, safeImageSrc } from '../lib/markdown';
import { turndown } from '../lib/turndown';
import { insertBlock, link as mdLink, prefixLines, TABLE, wrap, type Edit } from '../lib/mdEdit';
import { MOD } from '../lib/shortcuts';
import { Icon, type IconName } from './ui/Icon';
import { useConfirm } from './ui/ConfirmProvider';
import { EmbedPortals, useEmbedTargets } from './MarkdownView';
import { DiagramPicker } from './InsertDiagramDialog';

type Mode = 'source' | 'rich';
const MODE_KEY = 'clara.editor.mode';

interface Props {
  value: string;
  onChange: (md: string) => void;
  /** For the Insert diagram picker. */
  workspaceId: string;
  /** Called on ⌘S so the page can flush its pending save. */
  onSaveNow?: () => void;
  /** Creates a diagram for "New diagram" in the picker; resolves to its id. */
  onCreateDiagram?: (name: string) => Promise<string>;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function MarkdownEditor({ value, onChange, workspaceId, onSaveNow, onCreateDiagram }: Props) {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'rich' ? 'rich' : 'source';
    } catch {
      return 'source';
    }
  });
  const [picking, setPicking] = useState(false);
  const { prompt } = useConfirm();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const richRef = useRef<HTMLDivElement>(null);
  /** Selection saved before a dialog steals focus, so the insert lands where the cursor was. */
  const savedRange = useRef<Range | null>(null);
  const [richVersion, setRichVersion] = useState(0);
  const [targets, setTargets] = useEmbedTargets(richRef, [mode, richVersion]);

  // Entering rich mode (or an external change while in it, e.g. a version restore) re-renders the HTML.
  const lastEmitted = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== 'rich' || !richRef.current) return;
    if (lastEmitted.current === value) return;
    richRef.current.innerHTML = renderMarkdown(value || '');
    setRichVersion((v) => v + 1);
  }, [mode, value]);

  function switchMode(m: Mode) {
    lastEmitted.current = null;
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------- source mode
  function applySource(fn: (e: Edit) => Edit) {
    const t = textRef.current;
    if (!t) return;
    const r = fn({ value, start: t.selectionStart, end: t.selectionEnd });
    onChange(r.value);
    requestAnimationFrame(() => {
      t.focus();
      t.setSelectionRange(r.start, r.end);
    });
  }

  // ---------------------------------------------------------- rich mode
  function emitRich() {
    if (!richRef.current) return;
    const md = turndown.turndown(richRef.current.innerHTML);
    lastEmitted.current = md;
    onChange(md);
  }
  function exec(cmd: string, arg?: string) {
    richRef.current?.focus();
    document.execCommand(cmd, false, arg);
    emitRich();
  }
  function insertHtml(html: string) {
    richRef.current?.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
      savedRange.current = null;
    }
    document.execCommand('insertHTML', false, html);
    emitRich();
    setTargets(richRef.current ? [...richRef.current.querySelectorAll<HTMLElement>('.md-embed')] : []);
  }
  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && richRef.current?.contains(sel.anchorNode))
      savedRange.current = sel.getRangeAt(0).cloneRange();
  }

  // ---------------------------------------------------------- actions (both modes)
  async function askUrl(title: string, label: string, def = 'https://') {
    saveSelection();
    return prompt({
      title,
      label,
      defaultValue: def,
      confirmLabel: 'Insert',
      validate: (v) => (v.trim() ? undefined : 'Enter a URL'),
    });
  }

  const actions: Record<string, () => void | Promise<void>> = {
    h2: () => (mode === 'source' ? applySource((e) => prefixLines(e, '## ')) : exec('formatBlock', 'H2')),
    h3: () => (mode === 'source' ? applySource((e) => prefixLines(e, '### ')) : exec('formatBlock', 'H3')),
    bold: () => (mode === 'source' ? applySource((e) => wrap(e, '**')) : exec('bold')),
    italic: () => (mode === 'source' ? applySource((e) => wrap(e, '*')) : exec('italic')),
    code: () => {
      if (mode === 'source') return applySource((e) => wrap(e, '`', '`', 'code'));
      const text = window.getSelection()?.toString() || 'code';
      insertHtml(`<code>${esc(text)}</code>`);
    },
    ul: () => (mode === 'source' ? applySource((e) => prefixLines(e, '- ')) : exec('insertUnorderedList')),
    ol: () => (mode === 'source' ? applySource((e) => prefixLines(e, (i) => `${i + 1}. `)) : exec('insertOrderedList')),
    quote: () => (mode === 'source' ? applySource((e) => prefixLines(e, '> ')) : exec('formatBlock', 'BLOCKQUOTE')),
    link: async () => {
      if (mode === 'source') return applySource((e) => mdLink(e));
      const url = await askUrl('Insert link', 'URL');
      const href = url && safeHref(url);
      if (!href) return;
      const text = savedRange.current?.toString() || url!;
      insertHtml(`<a href="${esc(href)}">${esc(text)}</a>`);
    },
    codeblock: () =>
      mode === 'source'
        ? applySource((e) => insertBlock(e, '```\ncode\n```', 'code'))
        : insertHtml('<pre><code>code</code></pre><p><br></p>'),
    table: () =>
      mode === 'source'
        ? applySource((e) => insertBlock(e, TABLE, 'Column'))
        : insertHtml(
            '<table><thead><tr><th>Column</th><th>Column</th></tr></thead><tbody><tr><td>Cell</td><td>Cell</td></tr></tbody></table><p><br></p>',
          ),
    image: async () => {
      const url = await askUrl('Insert image', 'Image URL (https://…)');
      const src = url && safeImageSrc(url);
      if (!src) return;
      if (mode === 'source') applySource((e) => insertBlock(e, `![Image description](${src})`, 'Image description'));
      else insertHtml(`<img src="${esc(src)}" alt="">`);
    },
    hr: () => (mode === 'source' ? applySource((e) => insertBlock(e, '---')) : exec('insertHorizontalRule')),
    diagram: () => {
      saveSelection();
      setPicking(true);
    },
  };

  function insertDiagram(id: string) {
    setPicking(false);
    if (mode === 'source') applySource((e) => insertBlock(e, embedBlock({ id })));
    else insertHtml(`<div class="md-embed" contenteditable="false" data-diagram-id="${id}"></div><p><br></p>`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const map: Record<string, string> = { b: 'bold', i: 'italic', e: 'code' };
    if (map[k] && !e.shiftKey) {
      e.preventDefault();
      actions[map[k]]();
    } else if (k === 's') {
      e.preventDefault();
      onSaveNow?.();
    }
  }

  const tools: ([string, IconName, string, string?] | 'sep')[] = [
    ['h2', 'heading', 'Heading'],
    ['bold', 'bold', 'Bold', `${MOD}+B`],
    ['italic', 'italic', 'Italic', `${MOD}+I`],
    ['code', 'code', 'Inline code', `${MOD}+E`],
    'sep',
    ['ul', 'list', 'Bulleted list'],
    ['ol', 'list', 'Numbered list'],
    ['quote', 'quote', 'Quote'],
    'sep',
    ['link', 'link', 'Link'],
    ['codeblock', 'code', 'Code block'],
    ['table', 'table', 'Table'],
    ['image', 'image', 'Image'],
    ['hr', 'move', 'Divider'],
  ];

  return (
    <div className="md-editor">
      <div className="md-toolbar" role="toolbar" aria-label="Formatting">
        <div className="segmented" role="radiogroup" aria-label="Editor view">
          {(['source', 'rich'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={mode === m ? 'on' : ''}
              onClick={() => switchMode(m)}
            >
              {m === 'source' ? 'Markdown' : 'Rich text'}
            </button>
          ))}
        </div>
        <span className="toolbar-sep" />
        {tools.map((t, i) =>
          t === 'sep' ? (
            <span key={`s${i}`} className="toolbar-sep" />
          ) : (
            <button
              key={t[0]}
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              title={t[3] ? `${t[2]} (${t[3]})` : t[2]}
              aria-label={t[2]}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => actions[t[0]]()}
            >
              {t[0] === 'ol' ? (
                <span className="ol-glyph" aria-hidden="true">
                  1.
                </span>
              ) : t[0] === 'hr' ? (
                <span aria-hidden="true">—</span>
              ) : (
                <Icon name={t[1]} />
              )}
            </button>
          ),
        )}
        <span className="toolbar-sep" />
        <button type="button" className="btn btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={actions.diagram}>
          <Icon name="diagram" /> Insert diagram
        </button>
      </div>

      {mode === 'source' ? (
        <textarea
          ref={textRef}
          className="md-source"
          aria-label="Document (markdown)"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={'# Title\n\nStart writing. Markdown works; switch to Rich text for formatting buttons.'}
        />
      ) : (
        <>
          <div
            ref={richRef}
            className="md-wysiwyg prose"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Document (rich text)"
            onInput={emitRich}
            onKeyDown={onKeyDown}
            onBlur={saveSelection}
          />
          <EmbedPortals targets={targets} />
        </>
      )}

      {picking && (
        <DiagramPicker
          open
          title="Insert a diagram"
          description="The embed always shows the diagram’s latest version."
          workspaceId={workspaceId}
          confirmLabel="Insert"
          onClose={() => setPicking(false)}
          onPick={(d) => insertDiagram(d.id)}
          onCreate={
            onCreateDiagram
              ? async (name) => {
                  const id = await onCreateDiagram(name);
                  insertDiagram(id);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
