/** Pure text edits for the markdown source toolbar: (text, selection) in, (text, selection) out. */
export interface Edit {
  value: string;
  start: number;
  end: number;
}

/** Wraps the selection (or a placeholder) in `before`/`after`; unwraps if already wrapped. */
export function wrap(e: Edit, before: string, after = before, placeholder = 'text'): Edit {
  const sel = e.value.slice(e.start, e.end);
  const pre = e.value.slice(0, e.start);
  const post = e.value.slice(e.end);
  if (pre.endsWith(before) && post.startsWith(after) && sel) {
    return { value: pre.slice(0, -before.length) + sel + post.slice(after.length), start: e.start - before.length, end: e.end - before.length };
  }
  const body = sel || placeholder;
  return { value: pre + before + body + after + post, start: e.start + before.length, end: e.start + before.length + body.length };
}

/** Toggles a prefix (e.g. "## ", "- ", "> ") on every line the selection touches. */
export function prefixLines(e: Edit, prefix: string | ((i: number) => string)): Edit {
  const lineStart = e.value.lastIndexOf('\n', e.start - 1) + 1;
  const nl = e.value.indexOf('\n', e.end);
  const lineEnd = nl === -1 ? e.value.length : nl;
  const lines = e.value.slice(lineStart, lineEnd).split('\n');
  const p = (i: number) => (typeof prefix === 'function' ? prefix(i) : prefix);
  const pattern = typeof prefix === 'function' ? /^\d+\.\s/ : new RegExp(`^${p(0).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const all = lines.every((l) => pattern.test(l));
  // Headings replace each other rather than stacking.
  const strip = (l: string) => l.replace(/^#{1,6}\s/, '');
  const next = lines.map((l, i) => (all ? l.replace(pattern, '') : p(i) + (typeof prefix === 'string' && prefix.startsWith('#') ? strip(l) : l)));
  const text = next.join('\n');
  return { value: e.value.slice(0, lineStart) + text + e.value.slice(lineEnd), start: lineStart, end: lineStart + text.length };
}

/** Inserts a block on its own lines at the cursor, selecting `select` within it if given. */
export function insertBlock(e: Edit, block: string, select?: string): Edit {
  const pre = e.value.slice(0, e.start);
  const post = e.value.slice(e.end);
  const lead = pre === '' || pre.endsWith('\n\n') ? '' : pre.endsWith('\n') ? '\n' : '\n\n';
  const trail = post === '' || post.startsWith('\n\n') ? '' : post.startsWith('\n') ? '\n' : '\n\n';
  const at = pre.length + lead.length;
  const idx = select ? block.indexOf(select) : -1;
  return {
    value: pre + lead + block + trail + post,
    start: idx >= 0 ? at + idx : at + block.length,
    end: idx >= 0 ? at + idx + select!.length : at + block.length,
  };
}

export function link(e: Edit, url = 'https://'): Edit {
  const sel = e.value.slice(e.start, e.end) || 'link text';
  const text = `[${sel}](${url})`;
  const value = e.value.slice(0, e.start) + text + e.value.slice(e.end);
  const urlAt = e.start + sel.length + 3;
  return { value, start: urlAt, end: urlAt + url.length };
}

export const TABLE = '| Column | Column |\n| --- | --- |\n| Cell | Cell |';
