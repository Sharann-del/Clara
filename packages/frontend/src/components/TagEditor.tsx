import { useState } from 'react';
import { Dialog } from './ui/Dialog';
import { Icon } from './ui/Icon';

export const normalizeTag = (t: string) => t.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').slice(0, 40);

/** Add and remove tags; suggests tags already used in the workspace. */
export function TagEditor({
  open,
  name,
  tags: initial,
  suggestions,
  onSave,
  onClose,
}: {
  open: boolean;
  name: string;
  tags: string[];
  suggestions: string[];
  onSave: (tags: string[]) => void;
  onClose: () => void;
}) {
  const [tags, setTags] = useState(initial);
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const t = normalizeTag(raw);
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setDraft('');
  };
  const unused = suggestions.filter((s) => !tags.includes(s) && (!draft || s.includes(normalizeTag(draft)))).slice(0, 10);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Tags"
      description={`Tags for “${name}”. They work across folders and show up in search.`}
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onSave(draft.trim() ? [...new Set([...tags, normalizeTag(draft)])].filter(Boolean) : tags)}
          >
            Save tags
          </button>
        </>
      }
    >
      <div className="tag-editor" aria-live="polite">
        {tags.length === 0 && <span className="muted">No tags yet.</span>}
        {tags.map((t) => (
          <span key={t} className="tag">
            {t}
            <button type="button" className="tag-x" aria-label={`Remove tag ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}>
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add(draft);
        }}
        style={{ display: 'flex', gap: 6 }}
      >
        <label className="sr-only" htmlFor="tag-input">
          Add a tag
        </label>
        <input
          id="tag-input"
          className="input"
          style={{ flex: 1 }}
          placeholder="Add a tag and press Enter"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === ',') {
              e.preventDefault();
              add(draft);
            }
          }}
        />
        <button type="submit" className="btn">
          Add
        </button>
      </form>
      {unused.length > 0 && (
        <div className="tag-suggest">
          <span className="muted">Used in this workspace:</span>
          {unused.map((s) => (
            <button key={s} type="button" className="tag tag-button tag-neutral" onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}
