import { Link } from 'react-router-dom';
import { Icon } from './ui/Icon';
import { Menu, type MenuItem } from './ui/Menu';
import { timeAgo } from '../lib/time';

export interface ListItem {
  kind: 'document' | 'diagram' | 'folder';
  id: string;
  name: string;
  tags?: string[];
  updatedAt?: string;
  /** Secondary text, e.g. the workspace name on the home page. */
  context?: string;
}

interface Props {
  items: ListItem[];
  /** Actions for a row's "…" menu. Omit for read-only lists. */
  actions?: (item: ListItem) => (MenuItem | 'separator')[];
  onOpenFolder?: (id: string) => void;
  /** Drag source support (folders, documents, diagrams). */
  draggable?: boolean;
  onDragStartItem?: (item: ListItem, e: React.DragEvent) => void;
  /** Drop onto a folder row. */
  onDropOnFolder?: (folderId: string, e: React.DragEvent) => void;
  onTagClick?: (tag: string) => void;
  /** Leading icon element override per item (e.g. favourite star). */
  trailing?: (item: ListItem) => React.ReactNode;
}

const ICON = { document: 'doc', diagram: 'diagram', folder: 'folder' } as const;

export function ItemList({ items, actions, onOpenFolder, draggable, onDragStartItem, onDropOnFolder, onTagClick, trailing }: Props) {
  return (
    <ul className="item-list" role="list">
      {items.map((it, index) => (
        <li
          key={`${it.kind}:${it.id}`}
          className={`item-row item-${it.kind}`}
          draggable={draggable}
          onDragStart={(e) => onDragStartItem?.(it, e)}
          onDragOver={(e) => {
            if (it.kind === 'folder' && onDropOnFolder) {
              e.preventDefault();
              e.currentTarget.classList.add('drop-target');
            }
          }}
          onDragLeave={(e) => e.currentTarget.classList.remove('drop-target')}
          onDrop={(e) => {
            e.currentTarget.classList.remove('drop-target');
            if (it.kind === 'folder' && onDropOnFolder) {
              e.preventDefault();
              onDropOnFolder(it.id, e);
            }
          }}
        >
          <span className={`item-icon item-icon-${it.kind}`} aria-hidden="true">
            <Icon name={ICON[it.kind]} />
          </span>
          {it.kind === 'folder' ? (
            <button type="button" className="item-name item-link" onClick={() => onOpenFolder?.(it.id)}>
              {it.name}
            </button>
          ) : (
            <Link to={`/${it.kind}s/${it.id}`} className="item-name item-link">
              {it.name}
            </Link>
          )}
          <span className="item-tags">
            {it.tags?.map((t) =>
              onTagClick ? (
                <button key={t} type="button" className="tag tag-button" onClick={() => onTagClick(t)} aria-label={`Filter by tag ${t}`}>
                  {t}
                </button>
              ) : (
                <span key={t} className="tag">
                  {t}
                </span>
              ),
            )}
          </span>
          {it.context && <span className="item-context hide-mobile">{it.context}</span>}
          <span className="item-time hide-mobile">{timeAgo(it.updatedAt)}</span>
          {trailing?.(it)}
          {actions && (
            <span data-tour={index === 0 ? 'item-menu' : undefined} style={{ display: 'inline-flex' }}>
              <Menu
                className="btn btn-ghost btn-icon btn-sm"
                label={`Actions for ${it.name}`}
                trigger={<Icon name="more" />}
                items={actions(it)}
              />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
