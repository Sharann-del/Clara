import { useState } from 'react';
import type { Folder } from '../lib/api';
import { Icon } from './ui/Icon';
import { Menu } from './ui/Menu';

export interface FolderActions {
  onNewSubfolder: (parent: Folder | null) => void;
  onRename: (folder: Folder) => void;
  onMove: (folder: Folder) => void;
  onDelete: (folder: Folder) => void;
}

interface Props {
  folders: Folder[];
  /** undefined = "All items" (no folder filter), null = top level only. */
  selectedFolderId: string | null | undefined;
  onSelect: (folderId: string | null) => void;
  /** Present for editors: folder menus and drop targets. */
  actions?: FolderActions;
  /** Something was dropped onto a folder (null = workspace root). */
  onDrop?: (folderId: string | null, e: React.DragEvent) => void;
  onDragStartFolder?: (folder: Folder, e: React.DragEvent) => void;
}

const EXPANDED_KEY = 'clara.folders.collapsed';
function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function dropProps(target: string | null, onDrop?: Props['onDrop']) {
  if (!onDrop) return {};
  return {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-clara-item')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      e.currentTarget.classList.add('drop-target');
    },
    onDragLeave: (e: React.DragEvent) => e.currentTarget.classList.remove('drop-target'),
    onDrop: (e: React.DragEvent) => {
      e.currentTarget.classList.remove('drop-target');
      e.preventDefault();
      onDrop(target, e);
    },
  };
}

export function FolderTree({ folders, selectedFolderId, onSelect, actions, onDrop, onDragStartFolder }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });

  const children = (parent: string | null) =>
    folders.filter((f) => f.parent_folder_id === parent).sort((a, b) => a.name.localeCompare(b.name));

  const renderNode = (folder: Folder, depth: number) => {
    const kids = children(folder.id);
    const open = !collapsed.has(folder.id);
    return (
      <li key={folder.id} role="none">
        <div
          className={`folder-row ${selectedFolderId === folder.id ? 'active' : ''}`}
          style={{ paddingLeft: 4 + depth * 14 }}
          draggable={!!actions}
          onDragStart={(e) => onDragStartFolder?.(folder, e)}
          {...dropProps(folder.id, onDrop)}
        >
          {kids.length > 0 ? (
            <button
              type="button"
              className="folder-twisty"
              aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
              aria-expanded={open}
              onClick={() => toggle(folder.id)}
            >
              <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
            </button>
          ) : (
            <span className="folder-twisty" aria-hidden="true" />
          )}
          <button
            type="button"
            className="folder-name"
            aria-current={selectedFolderId === folder.id ? 'true' : undefined}
            onClick={() => onSelect(folder.id)}
          >
            <Icon name={selectedFolderId === folder.id ? 'folderOpen' : 'folder'} />
            <span>{folder.name}</span>
          </button>
          {actions && (
            <Menu
              className="btn btn-ghost btn-icon btn-sm folder-more"
              label={`Folder actions for ${folder.name}`}
              trigger={<Icon name="more" size={14} />}
              items={[
                { label: 'New subfolder', icon: 'plus', onSelect: () => actions.onNewSubfolder(folder) },
                { label: 'Rename', icon: 'edit', onSelect: () => actions.onRename(folder) },
                { label: 'Move to…', icon: 'move', onSelect: () => actions.onMove(folder) },
                'separator',
                { label: 'Delete folder', icon: 'trash', danger: true, onSelect: () => actions.onDelete(folder) },
              ]}
            />
          )}
        </div>
        {open && kids.length > 0 && (
          <ul role="group" className="folder-list">
            {kids.map((k) => renderNode(k, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="folder-tree">
      <div className="sidebar-section-label">
        <span>Folders</span>
        {actions && (
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            aria-label="New folder"
            onClick={() => actions.onNewSubfolder(null)}
          >
            <Icon name="plus" size={14} />
          </button>
        )}
      </div>
      <ul className="folder-list" role="list">
        <li role="none">
          <div className={`folder-row ${selectedFolderId === null ? 'active' : ''}`} {...dropProps(null, onDrop)}>
            <span className="folder-twisty" aria-hidden="true" />
            <button
              type="button"
              className="folder-name"
              aria-current={selectedFolderId === null ? 'true' : undefined}
              onClick={() => onSelect(null)}
            >
              <Icon name="layers" />
              <span>Top level</span>
            </button>
          </div>
        </li>
        {children(null).map((f) => renderNode(f, 0))}
      </ul>
      {folders.length === 0 && actions && (
        <p className="muted" style={{ padding: '4px 10px' }}>
          Group documents and diagrams into folders.
        </p>
      )}
    </div>
  );
}
