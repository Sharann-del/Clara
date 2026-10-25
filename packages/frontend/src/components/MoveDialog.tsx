import { useState } from 'react';
import { Dialog } from './ui/Dialog';
import { Icon } from './ui/Icon';
import type { Folder } from '../lib/api';

/** Pick a destination folder (or the workspace root). The keyboard-accessible alternative to drag and drop. */
export function MoveDialog({
  open,
  title,
  folders,
  currentFolderId,
  excludeFolderId,
  onMove,
  onClose,
}: {
  open: boolean;
  title: string;
  folders: Folder[];
  currentFolderId: string | null;
  /** When moving a folder: it and its descendants can't be the destination. */
  excludeFolderId?: string;
  onMove: (folderId: string | null) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<string | null>(currentFolderId);
  const excluded = new Set<string>();
  if (excludeFolderId) {
    const walk = (id: string) => {
      excluded.add(id);
      folders.filter((f) => f.parent_folder_id === id).forEach((f) => walk(f.id));
    };
    walk(excludeFolderId);
  }
  const rows: { folder: Folder | null; depth: number }[] = [{ folder: null, depth: 0 }];
  const add = (parent: string | null, depth: number) =>
    folders
      .filter((f) => f.parent_folder_id === parent && !excluded.has(f.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((f) => {
        rows.push({ folder: f, depth });
        add(f.id, depth + 1);
      });
  add(null, 1);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={target === currentFolderId}
            onClick={() => onMove(target)}
          >
            Move here
          </button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Destination folder" className="move-list">
        {rows.map(({ folder, depth }) => {
          const id = folder?.id ?? null;
          return (
            <label
              key={id ?? 'root'}
              className={`folder-tree-item ${target === id ? 'active' : ''}`}
              style={{ paddingLeft: 8 + depth * 16 }}
            >
              <input
                type="radio"
                name="move-target"
                className="sr-only"
                checked={target === id}
                onChange={() => setTarget(id)}
              />
              <Icon name={folder ? 'folder' : 'layers'} />
              {folder ? folder.name : 'Workspace root'}
              {id === currentFolderId && (
                <span className="muted" style={{ marginLeft: 'auto' }}>
                  current
                </span>
              )}
            </label>
          );
        })}
      </div>
    </Dialog>
  );
}
