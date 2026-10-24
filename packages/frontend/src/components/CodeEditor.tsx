import { useRef, type KeyboardEvent } from 'react';
import type { ParseIssue } from '@clara/shared/dsl';

interface Props {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  issues?: ParseIssue[];
  label: string;
  readOnly?: boolean;
  /** Extra key handling (e.g. Cmd+S) before the default. Return true if handled. */
  onKey?: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean | void;
  placeholder?: string;
}

/**
 * Plain textarea with a line-number gutter that marks lines the parser skipped. Tab indents
 * (two spaces); press Esc first to let Tab move focus instead, so keyboard users never get trapped.
 */
export function CodeEditor({ id, value, onChange, issues = [], label, readOnly, onKey, placeholder }: Props) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const tabEscapes = useRef(false);
  const lines = value.split('\n').length;
  const bad = new Map(issues.map((i) => [i.line, i.message]));

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (onKey?.(e)) return;
    if (e.key === 'Escape') {
      tabEscapes.current = true;
      return;
    }
    if (e.key === 'Tab' && !tabEscapes.current && !readOnly) {
      e.preventDefault();
      const t = e.currentTarget;
      const { selectionStart: s, selectionEnd: end } = t;
      if (e.shiftKey) {
        const lineStart = value.lastIndexOf('\n', s - 1) + 1;
        if (value.slice(lineStart, lineStart + 2) === '  ') {
          const next = value.slice(0, lineStart) + value.slice(lineStart + 2);
          onChange(next);
          requestAnimationFrame(() => t.setSelectionRange(Math.max(lineStart, s - 2), Math.max(lineStart, end - 2)));
        }
        return;
      }
      // insertText keeps the browser's native undo stack intact; fall back to a manual splice.
      if (!document.execCommand?.('insertText', false, '  ')) {
        onChange(`${value.slice(0, s)}  ${value.slice(end)}`);
        requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2));
      }
      return;
    }
    tabEscapes.current = false;
  }

  return (
    <div className="code-editor">
      <div className="code-gutter" ref={gutterRef} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className={bad.has(i + 1) ? 'bad' : undefined} title={bad.get(i + 1)}>
            {i + 1}
          </div>
        ))}
      </div>
      <textarea
        id={id}
        className="code-input"
        aria-label={label}
        aria-describedby={id ? `${id}-status` : undefined}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        wrap="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
      />
    </div>
  );
}
