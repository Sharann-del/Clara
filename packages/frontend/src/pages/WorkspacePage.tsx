import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppShell, Crumbs } from '../components/AppShell';
import { FolderTree } from '../components/FolderTree';
import { ItemList, type ListItem } from '../components/ItemList';
import { EmptyState, SkeletonRows } from '../components/EmptyState';
import { NoAccess } from '../components/NoAccess';
import { PendingChangesPanel } from '../components/PendingChangesPanel';
import { MembersDialog } from '../components/MembersDialog';
import { MoveDialog } from '../components/MoveDialog';
import { TagEditor } from '../components/TagEditor';
import { SubPage } from '../components/ui/SubPage';
import { ProductTour, tourDone } from '../components/ProductTour';
import { Icon } from '../components/ui/Icon';
import { Menu } from '../components/ui/Menu';
import { useToast } from '../components/ui/Toast';
import { useConfirm } from '../components/ui/ConfirmProvider';
import { useRegisterWorkspace } from '../components/CommandPalette';
import {
  api,
  ApiError,
  errorMessage,
  type DiagramSummary,
  type DocumentSummary,
  type Folder,
  type Role,
  type Workspace,
} from '../lib/api';
import { useFavorites } from '../lib/favorites';
import { refreshWorkspaces } from '../lib/useWorkspaces';
import { usePageMeta } from '../lib/seo';
import { useAuthSub } from '../lib/useAuthSub';

type Kind = 'all' | 'document' | 'diagram';
type Sort = 'updated' | 'name';
const DRAG_TYPE = 'application/x-clara-item';
const atLeast = (role: Role | undefined, min: Role) =>
  !!role && ['viewer', 'editor', 'admin', 'owner'].indexOf(role) >= ['viewer', 'editor', 'admin', 'owner'].indexOf(min);

export function WorkspacePage() {
  const { workspaceId, '*': sub } = useParams<{ workspaceId: string; '*': string }>();
  const base = `/workspaces/${workspaceId}`;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm, prompt } = useConfirm();
  const mySub = useAuthSub();
  const { isFavorite, toggle: toggleFavorite } = useFavorites();
  useRegisterWorkspace(workspaceId);

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [diagrams, setDiagrams] = useState<DiagramSummary[] | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [moving, setMoving] = useState<ListItem | Folder | null>(null);
  const [tagging, setTagging] = useState<ListItem | null>(null);
  const [touring, setTouring] = useState(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [sort, setSort] = useState<Sort>('updated');

  const folderParam = params.get('folder');
  const folderId: string | null | undefined =
    folderParam === null ? undefined : folderParam === 'root' ? null : folderParam;
  const activeTags = useMemo(() => params.getAll('tag'), [params]);
  const role = workspace?.role;
  const canEdit = atLeast(role, 'editor');
  usePageMeta(workspace?.name ?? 'Workspace', { noindex: true });

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoadError(null);
    try {
      const [ws, fs, docs, dgs] = await Promise.all([
        api.getWorkspace(workspaceId),
        api.listFolders(workspaceId),
        api.listDocuments(workspaceId),
        api.listDiagrams(workspaceId),
      ]);
      setWorkspace(ws);
      setFolders(fs);
      setDocuments(docs);
      setDiagrams(dgs);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e : new ApiError(0, errorMessage(e)));
    }
  }, [workspaceId]);
  useEffect(() => {
    setDocuments(null);
    setDiagrams(null);
    load();
  }, [load]);

  const refreshPending = useCallback(() => {
    if (workspaceId && canEdit)
      api
        .countPendingChanges(workspaceId)
        .then((r) => setPendingCount(r.count))
        .catch(() => undefined);
  }, [workspaceId, canEdit]);
  useEffect(refreshPending, [refreshPending]);

  // The first-run tour starts once the page has rendered its targets.
  useEffect(() => {
    if (params.get('tour') && documents && !tourDone()) {
      const t = setTimeout(() => setTouring(true), 400);
      return () => clearTimeout(t);
    }
  }, [params, documents]);

  const setFolder = (id: string | null | undefined) => {
    const next = new URLSearchParams(params);
    next.delete('tour');
    if (id === undefined) next.delete('folder');
    else next.set('folder', id ?? 'root');
    setParams(next);
  };
  const toggleTag = (tag: string) => {
    const next = new URLSearchParams(params);
    const tags = next.getAll('tag');
    next.delete('tag');
    (tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]).forEach((t) => next.append('tag', t));
    setParams(next);
  };

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of [...(documents ?? []), ...(diagrams ?? [])].flatMap((i) => i.tags))
      counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [documents, diagrams]);

  const items = useMemo<ListItem[] | null>(() => {
    if (!documents || !diagrams) return null;
    const q = query.trim().toLowerCase();
    const inFolder = (f: string | null) => folderId === undefined || f === folderId;
    const docs: ListItem[] = documents
      .filter((d) => inFolder(d.folder_id))
      .map((d) => ({ kind: 'document', id: d.id, name: d.title, tags: d.tags, updatedAt: d.updated_at }));
    const dgs: ListItem[] = diagrams
      .filter((d) => inFolder(d.folder_id))
      .map((d) => ({ kind: 'diagram', id: d.id, name: d.name, tags: d.tags, updatedAt: d.updated_at }));
    let list = [...(kind !== 'diagram' ? docs : []), ...(kind !== 'document' ? dgs : [])];
    if (activeTags.length) list = list.filter((i) => activeTags.every((t) => i.tags?.includes(t)));
    if (q)
      list = list.filter(
        (i) => i.name.toLowerCase().includes(q) || i.tags?.some((t) => t.includes(q.replace(/^#/, ''))),
      );
    list.sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
    );
    // Subfolders of the current folder lead the list when not filtering.
    const sub: ListItem[] =
      folderId !== undefined && !q && !activeTags.length && kind === 'all'
        ? folders
            .filter((f) => f.parent_folder_id === folderId)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((f) => ({ kind: 'folder', id: f.id, name: f.name }))
        : [];
    return [...sub, ...list];
  }, [documents, diagrams, folders, folderId, query, kind, sort, activeTags]);

  // ------------------------------------------------------------ actions
  const report = (e: unknown) => toast.error(errorMessage(e));

  async function create(k: 'document' | 'diagram') {
    if (!workspaceId) return;
    try {
      const target = folderId ?? null;
      if (k === 'document') navigate(`/documents/${(await api.createDocument(workspaceId, 'Untitled', target)).id}`);
      else navigate(`/diagrams/${(await api.createDiagram(workspaceId, 'Untitled diagram', target)).id}`);
    } catch (e) {
      report(e);
    }
  }

  async function newFolder(parent: Folder | null) {
    if (!workspaceId) return;
    const name = await prompt({
      title: parent ? `New folder in “${parent.name}”` : 'New folder',
      label: 'Folder name',
      placeholder: 'e.g. Payments',
      confirmLabel: 'Create folder',
    });
    if (!name) return;
    try {
      const f = await api.createFolder(
        workspaceId,
        name,
        parent?.id ?? (parent === null && folderId ? folderId : null),
      );
      setFolders((prev) => [...prev, f]);
      toast.success(`Created folder “${f.name}”`);
    } catch (e) {
      report(e);
    }
  }

  async function renameFolder(f: Folder) {
    const name = await prompt({
      title: 'Rename folder',
      label: 'Folder name',
      defaultValue: f.name,
      confirmLabel: 'Rename',
    });
    if (!name || name === f.name) return;
    try {
      const updated = await api.renameFolder(f.id, name);
      setFolders((prev) => prev.map((x) => (x.id === f.id ? updated : x)));
    } catch (e) {
      report(e);
    }
  }

  async function deleteFolder(f: Folder) {
    const descendants = (id: string): string[] =>
      folders.filter((x) => x.parent_folder_id === id).flatMap((x) => [x.id, ...descendants(x.id)]);
    const ids = new Set([f.id, ...descendants(f.id)]);
    const contained = [...(documents ?? []), ...(diagrams ?? [])].filter(
      (i) => i.folder_id && ids.has(i.folder_id),
    ).length;
    const ok = await confirm({
      title: `Delete folder “${f.name}”?`,
      message:
        (ids.size > 1 ? `Its ${ids.size - 1} subfolder${ids.size > 2 ? 's are' : ' is'} deleted too. ` : '') +
        (contained
          ? `The ${contained} item${contained === 1 ? '' : 's'} inside move to the top level; nothing else is deleted.`
          : 'It’s empty.'),
      confirmLabel: 'Delete folder',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteFolder(f.id);
      if (folderId && ids.has(folderId)) setFolder(undefined);
      toast.success(`Deleted folder “${f.name}”`);
      await load();
    } catch (e) {
      report(e);
    }
  }

  async function moveItem(item: { kind: ListItem['kind']; id: string; name?: string }, target: string | null) {
    try {
      if (item.kind === 'folder') {
        const updated = await api.moveFolder(item.id, target);
        setFolders((prev) => prev.map((x) => (x.id === item.id ? updated : x)));
      } else if (item.kind === 'document') {
        await api.updateDocument(item.id, { folderId: target });
        setDocuments((prev) => prev?.map((d) => (d.id === item.id ? { ...d, folder_id: target } : d)) ?? null);
      } else {
        await api.updateDiagram(item.id, { folderId: target });
        setDiagrams((prev) => prev?.map((d) => (d.id === item.id ? { ...d, folder_id: target } : d)) ?? null);
      }
      const dest = target ? folders.find((f) => f.id === target)?.name : 'the top level';
      toast.show(`Moved ${item.name ? `“${item.name}”` : 'item'} to ${dest}`, { tone: 'success' });
    } catch (e) {
      report(e);
    }
  }

  function onDrop(target: string | null, e: React.DragEvent) {
    try {
      const data = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as {
        kind: ListItem['kind'];
        id: string;
        name: string;
      };
      if (data.kind === 'folder' && data.id === target) return;
      moveItem(data, target);
    } catch {
      // not ours
    }
  }
  const startDrag = (data: { kind: string; id: string; name: string }, e: React.DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(data));
    e.dataTransfer.effectAllowed = 'move';
  };

  async function renameItem(it: ListItem) {
    const name = await prompt({
      title: `Rename ${it.kind}`,
      label: 'Name',
      defaultValue: it.name,
      confirmLabel: 'Rename',
    });
    if (!name || name === it.name) return;
    try {
      if (it.kind === 'document') {
        await api.updateDocument(it.id, { title: name });
        setDocuments((prev) => prev?.map((d) => (d.id === it.id ? { ...d, title: name } : d)) ?? null);
      } else if (it.kind === 'diagram') {
        await api.updateDiagram(it.id, { name });
        setDiagrams((prev) => prev?.map((d) => (d.id === it.id ? { ...d, name } : d)) ?? null);
      }
    } catch (e) {
      report(e);
    }
  }

  async function saveTags(it: ListItem, tags: string[]) {
    setTagging(null);
    try {
      if (it.kind === 'document') {
        await api.updateDocument(it.id, { tags });
        setDocuments((prev) => prev?.map((d) => (d.id === it.id ? { ...d, tags } : d)) ?? null);
      } else {
        await api.updateDiagram(it.id, { tags });
        setDiagrams((prev) => prev?.map((d) => (d.id === it.id ? { ...d, tags } : d)) ?? null);
      }
    } catch (e) {
      report(e);
    }
  }

  async function deleteItem(it: ListItem) {
    const ok = await confirm({
      title: `Delete “${it.name}”?`,
      message: `This deletes the ${it.kind} and its version history for everyone. It can’t be undone.`,
      confirmLabel: `Delete ${it.kind}`,
      danger: true,
    });
    if (!ok) return;
    try {
      if (it.kind === 'document') {
        await api.deleteDocument(it.id);
        setDocuments((prev) => prev?.filter((d) => d.id !== it.id) ?? null);
      } else {
        await api.deleteDiagram(it.id);
        setDiagrams((prev) => prev?.filter((d) => d.id !== it.id) ?? null);
      }
      toast.success(`Deleted “${it.name}”`);
    } catch (e) {
      report(e);
    }
  }

  async function renameWorkspace() {
    if (!workspace) return;
    const name = await prompt({
      title: 'Rename workspace',
      label: 'Name',
      defaultValue: workspace.name,
      confirmLabel: 'Rename',
    });
    if (!name || name === workspace.name) return;
    try {
      setWorkspace({ ...workspace, ...(await api.renameWorkspace(workspace.id, name)), role: workspace.role });
      refreshWorkspaces();
    } catch (e) {
      report(e);
    }
  }

  async function deleteWorkspace() {
    if (!workspace) return;
    const ok = await confirm({
      title: `Delete workspace “${workspace.name}”?`,
      message: 'Every folder, document, diagram and version in it is deleted for all members. This can’t be undone.',
      confirmLabel: 'Delete workspace',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteWorkspace(workspace.id);
      await refreshWorkspaces();
      toast.success(`Deleted “${workspace.name}”`);
      navigate('/app');
    } catch (e) {
      report(e);
    }
  }

  if (loadError) {
    if (loadError.status === 403 || loadError.status === 404)
      return <NoAccess what="workspace" notFound={loadError.status === 404} />;
    return (
      <AppShell title={<strong>Workspace</strong>}>
        <EmptyState
          icon="alert"
          title="This workspace didn’t load"
          actions={
            <button className="btn btn-primary" onClick={load}>
              Try again
            </button>
          }
        >
          {loadError.message}
        </EmptyState>
      </AppShell>
    );
  }

  const currentFolder = folderId ? folders.find((f) => f.id === folderId) : undefined;
  const folderPath: Folder[] = [];
  for (let f = currentFolder; f; f = folders.find((x) => x.id === f!.parent_folder_id)) folderPath.unshift(f);
  const heading =
    folderId === undefined ? 'All items' : folderId === null ? 'Top level' : (currentFolder?.name ?? 'Folder');
  const filtering = !!query || activeTags.length > 0 || kind !== 'all';

  const itemActions = (it: ListItem) => {
    if (it.kind === 'folder') {
      const f = folders.find((x) => x.id === it.id)!;
      return canEdit
        ? [
            { label: 'Open', icon: 'folderOpen' as const, onSelect: () => setFolder(f.id) },
            { label: 'Rename', icon: 'edit' as const, onSelect: () => renameFolder(f) },
            { label: 'Move to…', icon: 'move' as const, onSelect: () => setMoving(f) },
            'separator' as const,
            { label: 'Delete folder', icon: 'trash' as const, danger: true, onSelect: () => deleteFolder(f) },
          ]
        : [{ label: 'Open', icon: 'folderOpen' as const, onSelect: () => setFolder(f.id) }];
    }
    const fav = isFavorite(it.kind, it.id);
    return [
      {
        label: 'Open',
        icon: it.kind === 'document' ? ('doc' as const) : ('diagram' as const),
        onSelect: () => navigate(`/${it.kind}s/${it.id}`),
      },
      {
        label: fav ? 'Remove from favorites' : 'Add to favorites',
        icon: 'star' as const,
        onSelect: () =>
          toggleFavorite({ kind: it.kind as 'document' | 'diagram', id: it.id, name: it.name }).catch(report),
      },
      ...(canEdit
        ? [
            { label: 'Rename', icon: 'edit' as const, onSelect: () => renameItem(it) },
            { label: 'Edit tags', icon: 'tag' as const, onSelect: () => setTagging(it) },
            { label: 'Move to…', icon: 'move' as const, onSelect: () => setMoving(it) },
            { label: 'Share', icon: 'share' as const, onSelect: () => navigate(`/${it.kind}s/${it.id}/share`) },
            'separator' as const,
            { label: `Delete ${it.kind}`, icon: 'trash' as const, danger: true, onSelect: () => deleteItem(it) },
          ]
        : []),
    ];
  };

  return (
    <AppShell
      workspace={workspace}
      pendingCount={pendingCount}
      showPending={canEdit}
      showMembers
      title={
        <Crumbs
          items={[
            { label: workspace?.name ?? 'Workspace', to: `/workspaces/${workspaceId}` },
            ...(folderId === null
              ? [{ label: 'Top level' }]
              : folderPath.map((f) => ({ label: f.name, to: `/workspaces/${workspaceId}?folder=${f.id}` }))),
          ]}
        />
      }
      actions={
        <>
          <Menu
            className="btn btn-ghost btn-icon"
            label="Workspace actions"
            trigger={<Icon name="more" />}
            items={[
              ...(canEdit
                ? [{ label: 'New folder', icon: 'folder' as const, onSelect: () => newFolder(currentFolder ?? null) }]
                : []),
              { label: 'Members', icon: 'users' as const, onSelect: () => navigate(`${base}/members`) },
              ...(canEdit
                ? [
                    {
                      label: `Pending changes${pendingCount ? ` (${pendingCount})` : ''}`,
                      icon: 'review' as const,
                      onSelect: () => navigate(`${base}/pending`),
                    },
                  ]
                : []),
              { label: 'Show the tour again', icon: 'info' as const, onSelect: () => setTouring(true) },
              ...(atLeast(role, 'admin')
                ? [
                    'separator' as const,
                    { label: 'Rename workspace', icon: 'edit' as const, onSelect: renameWorkspace },
                  ]
                : []),
              ...(role === 'owner'
                ? [{ label: 'Delete workspace', icon: 'trash' as const, danger: true, onSelect: deleteWorkspace }]
                : []),
            ]}
          />
        </>
      }
      sidebar={
        <FolderTree
          folders={folders}
          selectedFolderId={folderId}
          onSelect={setFolder}
          actions={
            canEdit
              ? {
                  onNewSubfolder: newFolder,
                  onRename: renameFolder,
                  onMove: (f) => setMoving(f),
                  onDelete: deleteFolder,
                }
              : undefined
          }
          onDrop={canEdit ? onDrop : undefined}
          onDragStartFolder={(f, e) => startDrag({ kind: 'folder', id: f.id, name: f.name }, e)}
        />
      }
    >
      {!sub && (
        <>
          <div className="page-head">
            <div>
              <h1>{heading}</h1>
              {workspace && (
                <p className="muted" style={{ margin: '8px 0 0', fontSize: 15 }}>
                  {workspace.name} · you’re {role === 'admin' || role === 'owner' ? 'an' : 'a'} {role}
                </p>
              )}
            </div>
            {canEdit && (
              <div className="page-head-actions" data-tour="create">
                <button type="button" className="btn" onClick={() => create('diagram')}>
                  <Icon name="diagram" /> New diagram
                </button>
                <button type="button" className="btn btn-primary" onClick={() => create('document')}>
                  <Icon name="plus" /> New document
                </button>
              </div>
            )}
          </div>

          <div className="filters" role="search">
            <div className="filter-search">
              <Icon name="search" />
              <label htmlFor="ws-filter" className="sr-only">
                Filter by name or tag
              </label>
              <input
                id="ws-filter"
                placeholder="Filter by name or #tag"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="segmented" role="radiogroup" aria-label="Show">
              {(['all', 'document', 'diagram'] as Kind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  className={kind === k ? 'on' : ''}
                  onClick={() => setKind(k)}
                >
                  {k === 'all' ? 'All' : k === 'document' ? 'Docs' : 'Diagrams'}
                </button>
              ))}
            </div>
            <label className="sr-only" htmlFor="ws-sort">
              Sort
            </label>
            <select id="ws-sort" className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="updated">Recently updated</option>
              <option value="name">Name</option>
            </select>
          </div>
          {allTags.length > 0 && (
            <div className="tag-filter" role="group" aria-label="Filter by tag">
              <Icon name="tag" size={14} />
              {allTags.map(([t, n]) => (
                <button
                  key={t}
                  type="button"
                  className={`tag tag-button ${activeTags.includes(t) ? '' : 'tag-neutral'}`}
                  aria-pressed={activeTags.includes(t)}
                  onClick={() => toggleTag(t)}
                >
                  {t} <span className="tag-count">{n}</span>
                </button>
              ))}
              {activeTags.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => activeTags.forEach(toggleTag)}>
                  Clear
                </button>
              )}
            </div>
          )}

          {items === null ? (
            <SkeletonRows rows={5} />
          ) : items.length === 0 ? (
            filtering ? (
              <EmptyState
                icon="search"
                title="Nothing matches these filters"
                actions={
                  <button className="btn" onClick={() => (setQuery(''), setKind('all'), activeTags.forEach(toggleTag))}>
                    Clear filters
                  </button>
                }
              >
                Try another name, or remove a tag.
              </EmptyState>
            ) : (
              <EmptyState
                icon={folderId ? 'folder' : 'layers'}
                title={folderId ? 'This folder is empty' : 'Nothing here yet'}
                actions={
                  canEdit && (
                    <>
                      <button className="btn btn-primary" onClick={() => create('document')}>
                        <Icon name="doc" /> New document
                      </button>
                      <button className="btn" onClick={() => create('diagram')}>
                        <Icon name="diagram" /> New diagram
                      </button>
                    </>
                  )
                }
              >
                {canEdit
                  ? folderId
                    ? 'Create something here, or drag documents and diagrams onto this folder in the sidebar.'
                    : 'Start with a document for the reasoning or a diagram for the picture. Both can live side by side.'
                  : 'Nobody has added anything yet. Viewers can read and export what’s here once it exists.'}
              </EmptyState>
            )
          ) : (
            <ItemList
              items={items}
              actions={itemActions}
              onOpenFolder={(id) => setFolder(id)}
              draggable={canEdit}
              onDragStartItem={(it, e) => startDrag(it, e)}
              onDropOnFolder={canEdit ? (id, e) => onDrop(id, e) : undefined}
              onTagClick={toggleTag}
              trailing={(it) =>
                it.kind !== 'folder' && isFavorite(it.kind, it.id) ? (
                  <span className="star on" aria-label="Favorite" title="Favorite">
                    <Icon name="star" size={14} />
                  </span>
                ) : null
              }
            />
          )}
          {canEdit && items && items.length > 0 && (
            <p className="muted" style={{ marginTop: 10 }}>
              Tip: drag rows onto a folder in the sidebar, or use “Move to…” in a row’s menu.
            </p>
          )}
        </>
      )}

      {workspaceId && (
        <MembersDialog
          open={sub === 'members'}
          backTo={base}
          workspaceId={workspaceId}
          myRole={role}
          mySub={mySub ?? undefined}
        />
      )}
      {sub === 'pending' && workspaceId && (
        <SubPage title="Pending changes from AI assistants" backTo={base} size="lg">
          <PendingChangesPanel
            workspaceId={workspaceId}
            onChanged={() => {
              load();
              refreshPending();
            }}
          />
        </SubPage>
      )}
      {moving && (
        <MoveDialog
          open
          title={`Move “${moving.name}”`}
          folders={folders}
          currentFolderId={
            'kind' in moving
              ? moving.kind === 'folder'
                ? (folders.find((f) => f.id === moving.id)?.parent_folder_id ?? null)
                : ([...(documents ?? []), ...(diagrams ?? [])].find((d) => d.id === moving.id)?.folder_id ?? null)
              : moving.parent_folder_id
          }
          excludeFolderId={'kind' in moving ? (moving.kind === 'folder' ? moving.id : undefined) : moving.id}
          onClose={() => setMoving(null)}
          onMove={(target) => {
            const m = moving;
            setMoving(null);
            moveItem('kind' in m ? m : { kind: 'folder', id: m.id, name: m.name }, target);
          }}
        />
      )}
      {tagging && (
        <TagEditor
          open
          name={tagging.name}
          tags={tagging.tags ?? []}
          suggestions={allTags.map(([t]) => t)}
          onClose={() => setTagging(null)}
          onSave={(tags) => saveTags(tagging, tags)}
        />
      )}
      {touring && (
        <ProductTour
          onDone={() => setTouring(false)}
          steps={[
            {
              target: 'create',
              title: 'Create documents and diagrams',
              body: 'Docs hold the reasoning, diagrams the picture. A sample of each is already here.',
            },
            {
              target: 'search',
              title: 'Find anything with ⌘K',
              body: 'Search every workspace by title or #tag, or run commands like “New diagram”.',
            },
            {
              target: 'pending',
              title: 'Review AI changes',
              body: 'When Claude proposes an edit over MCP, it waits here as a diff until you accept or reject it.',
            },
            {
              target: 'item-menu',
              title: 'Organize and share',
              body: 'Each row’s menu moves it to a folder, edits tags, or shares it with one person or a public link.',
            },
          ]}
        />
      )}
    </AppShell>
  );
}
