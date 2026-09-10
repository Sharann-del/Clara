import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import TurndownService from 'turndown';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

interface Props {
  value: string;
  onChange: (md: string) => void;
}

export function MarkdownEditor({ value, onChange }: Props) {
  const [mode, setMode] = useState<'source' | 'wysiwyg'>('source');
  const editableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode === 'wysiwyg' && editableRef.current) {
      editableRef.current.innerHTML = marked.parse(value || '', { async: false }) as string;
    }
  }, [mode]);

  function handleInput() {
    if (!editableRef.current) return;
    onChange(turndown.turndown(editableRef.current.innerHTML));
  }

  function exec(cmd: string, arg?: string) {
    document.execCommand(cmd, false, arg);
    editableRef.current?.focus();
    handleInput();
  }

  return (
    <div>
      <div className="editor-toolbar">
        <button className={`btn ${mode === 'source' ? 'btn-primary' : ''}`} onClick={() => setMode('source')}>
          Source
        </button>
        <button
          className={`btn ${mode === 'wysiwyg' ? 'btn-primary' : ''}`}
          onClick={() => setMode('wysiwyg')}
        >
          WYSIWYG
        </button>
        {mode === 'wysiwyg' && (
          <>
            <span style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
            <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>
              <b>B</b>
            </button>
            <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>
              <i>I</i>
            </button>
            <button
              className="btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => exec('formatBlock', 'H2')}
            >
              H2
            </button>
            <button
              className="btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => exec('insertUnorderedList')}
            >
              • List
            </button>
          </>
        )}
      </div>
      {mode === 'source' ? (
        <textarea className="md-source" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <div
          className="md-wysiwyg"
          ref={editableRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
        />
      )}
    </div>
  );
}
