import type { Folder } from '../lib/api';

interface Props {
  folders: Folder[];
  selectedFolderId: string | null;
  onSelect: (folderId: string | null) => void;
}

function buildTree(folders: Folder[], parentId: string | null): Folder[] {
  return folders.filter((f) => f.parent_folder_id === parentId);
}

function FolderNode({
  folder,
  folders,
  depth,
  selectedFolderId,
  onSelect,
}: {
  folder: Folder;
  folders: Folder[];
  depth: number;
  selectedFolderId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const children = buildTree(folders, folder.id);
  return (
    <>
      <a
        className={`folder-tree-item ${selectedFolderId === folder.id ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(folder.id)}
      >
        📁 {folder.name}
      </a>
      {children.map((child) => (
        <FolderNode
          key={child.id}
          folder={child}
          folders={folders}
          depth={depth + 1}
          selectedFolderId={selectedFolderId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

export function FolderTree({ folders, selectedFolderId, onSelect }: Props) {
  const roots = buildTree(folders, null);
  return (
    <div>
      <a
        className={`folder-tree-item ${selectedFolderId === null ? 'active' : ''}`}
        onClick={() => onSelect(null)}
      >
        🗂️ All items
      </a>
      {roots.map((f) => (
        <FolderNode
          key={f.id}
          folder={f}
          folders={folders}
          depth={1}
          selectedFolderId={selectedFolderId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
