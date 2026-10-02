import { useState } from 'react';
import type { DiagramState } from '../lib/api';

interface Props {
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
export function StatesBar({ states, activeStateId, onSelect, onAdd, onRename, onMove, onDelete, onPresent }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const idx = states.findIndex((s) => s.id === activeStateId);
  const active = idx >= 0 ? states[idx] : undefined;

  function commitRename() {
    if (editingId && draft.trim()) onRename(editingId, draft.trim());
    setEditingId(null);
  }

  function add() {
    const name = window.prompt('New state name (e.g. "current", "interim", "future"):', '');
    if (name?.trim()) onAdd(name.trim(), Boolean(active) && window.confirm(`Start from a copy of "${active!.name}"?`));
  }

  return (
    <div className="states-bar">
      <span className="muted" style={{ fontSize: 12 }}>States</span>
      <button className={`state-chip ${activeStateId === null ? 'active' : ''}`} onClick={() => onSelect(null)}>
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
              setEditingId(s.id);
              setDraft(s.name);
            }}
            title="Double-click to rename"
          >
            {s.name}
          </button>
        ),
      )}
      <button className="state-chip" onClick={add} title="Add state">
        +
      </button>
      {active && (
        <span className="states-actions">
          <button className="btn" disabled={idx === 0} onClick={() => onMove(active.id, -1)} title="Move left">
            ←
          </button>
          <button className="btn" disabled={idx === states.length - 1} onClick={() => onMove(active.id, 1)} title="Move right">
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
            onClick={() => window.confirm(`Delete state "${active.name}"?`) && onDelete(active.id)}
          >
            Delete
          </button>
        </span>
      )}
      <div style={{ flex: 1 }} />
      {active && (
        <span className="muted" style={{ fontSize: 12 }}>
          Editing “{active.name}” — changes are saved to this state only
        </span>
      )}
      <button className="btn btn-primary" disabled={states.length === 0} onClick={onPresent}>
        ▶ Present
      </button>
    </div>
  );
}
