import { useEffect, useMemo, useState } from 'react';
import { Dialog } from './ui/Dialog';
import { Icon } from './ui/Icon';
import { SkeletonRows } from './EmptyState';
import { api, errorMessage, type DiagramSummary } from '../lib/api';
import { rankMatches } from '../lib/fuzzy';

/**
 * Pick a diagram from a workspace. Used to embed one in a document, and to link a shape
 * to a child diagram (C4 drill-down). `onCreate` offers making a new one instead.
 */
export function DiagramPicker({
  open,
  title,
  description,
  workspaceId,
  excludeIds = [],
  confirmLabel,
  onPick,
  onCreate,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  workspaceId: string;
  excludeIds?: string[];
  confirmLabel: string;
  onPick: (d: DiagramSummary) => void;
  onCreate?: (name: string) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState<DiagramSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api
      .listDiagrams(workspaceId)
      .then(setAll)
      .catch((e) => setError(errorMessage(e)));
  }, [open, workspaceId]);

  const list = useMemo(
    () => rankMatches((all ?? []).filter((d) => !excludeIds.includes(d.id)), q, (d) => [d.name, ...d.tags]).slice(0, 50),
    [all, q, excludeIds],
  );
  const pick = list.find((d) => d.id === selected);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="md"
      footer={
        <>
          {onCreate && (
            <button type="button" className="btn" style={{ marginRight: 'auto' }} onClick={() => onCreate(q.trim() || 'Untitled diagram')}>
              <Icon name="plus" /> New diagram{q.trim() ? ` “${q.trim()}”` : ''}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!pick} onClick={() => pick && onPick(pick)}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="filter-search">
        <Icon name="search" />
        <input aria-label="Find a diagram" placeholder="Find a diagram" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <div className="error-text">{error}</div>}
      {all === null ? (
        <SkeletonRows rows={4} height={34} />
      ) : list.length === 0 ? (
        <p className="muted">{all.length ? 'No diagram matches.' : 'This workspace has no diagrams yet.'}</p>
      ) : (
        <div role="listbox" aria-label="Diagrams" className="move-list">
          {list.map((d) => (
            <div
              key={d.id}
              role="option"
              tabIndex={0}
              aria-selected={selected === d.id}
              className={`folder-tree-item ${selected === d.id ? 'active' : ''}`}
              onClick={() => setSelected(d.id)}
              onDoubleClick={() => onPick(d)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onPick(d);
                if (e.key === ' ') {
                  e.preventDefault();
                  setSelected(d.id);
                }
              }}
            >
              <Icon name="diagram" /> {d.name}
              {d.tags.slice(0, 2).map((t) => (
                <span key={t} className="tag" style={{ marginLeft: 4 }}>
                  {t}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
