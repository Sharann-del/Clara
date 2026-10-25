import { useState } from 'react';
import type { DiagramState } from '../lib/api';
import { useConfirm } from './ui/ConfirmProvider';
import { Icon } from './ui/Icon';

interface Props {
  /** Viewers can switch states and present, not change them. */
  readOnly?: boolean;
  states: DiagramState[];
  activeStateId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (name: string, copyFromActive: boolean) => void;
  onRename: (id: string, name: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDelete: (id: string) => void;
  onPresent: () => void;
}

/** Tabs for the diagram's named states; "Base" is the underlying diagram (no overrides). */
export function StatesBar({
  readOnly,
  states,
  activeStateId,
  onSelect,
  onAdd,
  onRename,
  onMove,
  onDelete,
  onPresent,
}: Props) {
  const { prompt, confirm } = useConfirm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const idx = states.findIndex((s) => s.id === activeStateId);
  const active = idx >= 0 ? states[idx] : undefined;

  function commitRename() {
    if (editingId && draft.trim()) onRename(editingId, draft.trim());
    setEditingId(null);
  }

  async function add() {
    const name = await prompt({
      title: 'New state',
      message:
        'A state is a named version of this diagram, like “Today”, “Migrating” or “Target”. Changes you make in it don’t touch the base diagram.',
      label: 'State name',
      placeholder: 'e.g. Target',
      confirmLabel: 'Add state',
    });
    if (!name) return;
    const copy =
      Boolean(active) &&
      (await confirm({
        title: `Start from “${active!.name}”?`,
        message: `Copy what’s different in “${active!.name}” into “${name}”, or start from the base diagram.`,
        confirmLabel: `Copy “${active!.name}”`,
        cancelLabel: 'Start from base',
      }));
    onAdd(name, copy);
  }

  return (
    <div className="states-bar">
      <span className="muted" style={{ fontSize: 12 }}>
        States
      </span>
      <button
        className={`state-chip ${activeStateId === null ? 'active' : ''}`}
        aria-pressed={activeStateId === null}
        onClick={() => onSelect(null)}
      >
        Base
      </button>
      {states.map((s) =>
        editingId === s.id ? (
          <input
            key={s.id}
            autoFocus
            className="state-chip-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setEditingId(null);
            }}
          />
        ) : (
          <button
            key={s.id}
            className={`state-chip ${activeStateId === s.id ? 'active' : ''}`}
            onClick={() => onSelect(s.id)}
            onDoubleClick={() => {
              if (readOnly) return;
              setEditingId(s.id);
              setDraft(s.name);
            }}
            aria-pressed={activeStateId === s.id}
            title={readOnly ? undefined : 'Double-click to rename'}
          >
            {s.name}
          </button>
        ),
      )}
      {!readOnly && (
        <button className="state-chip" onClick={add} title="Add state" aria-label="Add state">
          +
        </button>
      )}
      {active && !readOnly && (
        <span className="states-actions">
          <button className="btn" disabled={idx === 0} onClick={() => onMove(active.id, -1)} title="Move left">
            ←
          </button>
          <button
            className="btn"
            disabled={idx === states.length - 1}
            onClick={() => onMove(active.id, 1)}
            title="Move right"
          >
            →
          </button>
          <button
            className="btn"
            onClick={() => {
              setEditingId(active.id);
              setDraft(active.name);
            }}
          >
            Rename
          </button>
          <button
            className="btn btn-danger"
            onClick={async () =>
              (await confirm({
                title: `Delete state “${active.name}”?`,
                message: 'Shapes drawn only in this state are removed from it. The base diagram is unchanged.',
                confirmLabel: 'Delete state',
                danger: true,
              })) && onDelete(active.id)
            }
          >
            Delete
          </button>
        </span>
      )}
      <div style={{ flex: 1 }} />
      {active && !readOnly && (
        <span className="muted hide-mobile" style={{ fontSize: 12 }}>
          Editing “{active.name}”: changes apply to this state only
        </span>
      )}
      <button
        className="btn btn-primary btn-sm"
        disabled={states.length === 0}
        onClick={onPresent}
        title={states.length === 0 ? 'Add a state to present' : undefined}
      >
        <Icon name="play" size={12} /> Present
      </button>
    </div>
  );
}
