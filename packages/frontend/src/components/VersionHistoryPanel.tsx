import { useEffect, useMemo, useState } from 'react';
import { diffLines } from 'diff';
import { describeElement, diffElements } from '@clara/shared/diff';
import { SubPage } from './ui/SubPage';
import { Icon } from './ui/Icon';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmProvider';
import { EmptyState, SkeletonRows } from './EmptyState';
import { DiagramViewer } from './DiagramViewer';
import { MarkdownView } from './MarkdownView';
import {
  api,
  errorMessage,
  normalizeElement,
  type DiagramElement,
  type VersionFull,
  type VersionSummary,
} from '../lib/api';
import { timeAgo } from '../lib/time';

interface Props {
  open: boolean;
  onClose: () => void;
  resourceKind: 'document' | 'diagram';
  resourceId: string;
  /** What the item looks like now, to diff against. */
  current: { contentMd?: string; title?: string; elements?: DiagramElement[] };
  canRestore: boolean;
  onRestored: () => void;
  /** Where "Back" falls back to. */
  backTo: string;
}

/** Version list with a preview and a diff against the current state before restoring. */
export function VersionHistoryPanel({
  open,
  onClose,
  resourceKind,
  resourceId,
  current,
  canRestore,
  onRestored,
  backTo,
}: Props) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [version, setVersion] = useState<VersionFull | null>(null);
  const [view, setView] = useState<'changes' | 'preview'>('changes');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVersions(null);
    const fn = resourceKind === 'document' ? api.documentVersions : api.diagramVersions;
    fn(resourceId)
      .then((v) => {
        setVersions(v);
        setSelected(v[0]?.id ?? null);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [open, resourceKind, resourceId]);

  useEffect(() => {
    if (!selected) return;
    setVersion(null);
    api
      .getVersion(resourceKind, resourceId, selected)
      .then(setVersion)
      .catch((e) => setError(errorMessage(e)));
  }, [selected, resourceKind, resourceId]);

  async function restore() {
    if (!version) return;
    const ok = await confirm({
      title: 'Restore this version?',
      message: `The ${resourceKind} goes back to how it was ${timeAgo(version.created_at)}. What it looks like now is saved as a new version first, so you can undo this.`,
      confirmLabel: 'Restore version',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const fn = resourceKind === 'document' ? api.restoreDocumentVersion : api.restoreDiagramVersion;
      await fn(resourceId, version.id);
      toast.success('Version restored. The previous state is saved in history.');
      onRestored();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <SubPage
      title="Version history"
      description="Every save keeps the previous version. Preview one, then restore it if you need to."
      backTo={backTo}
      size="lg"
    >
      {error && <div className="error-text">{error}</div>}
      {versions === null ? (
        <SkeletonRows rows={4} />
      ) : versions.length === 0 ? (
        <EmptyState icon="history" title="No earlier versions yet" compact>
          A version is saved each time this {resourceKind} changes.
        </EmptyState>
      ) : (
        <div className="history">
          <ul className="history-list" role="listbox" aria-label="Versions">
            {versions.map((v, i) => (
              <li
                key={v.id}
                role="option"
                tabIndex={0}
                aria-selected={selected === v.id}
                className={selected === v.id ? 'active' : ''}
                onClick={() => setSelected(v.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(v.id);
                  }
                  if (e.key === 'ArrowDown') (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
                  if (e.key === 'ArrowUp') (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
                }}
              >
                <strong>{timeAgo(v.created_at)}</strong>
                <span className="muted">{new Date(v.created_at).toLocaleString()}</span>
                {i === 0 && <span className="tag tag-neutral">latest saved</span>}
              </li>
            ))}
          </ul>
          <div className="history-preview">
            {!version ? (
              <SkeletonRows rows={6} height={22} />
            ) : (
              <>
                <div className="history-toolbar">
                  <div className="segmented" role="radiogroup" aria-label="Show">
                    {(['changes', 'preview'] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={view === v}
                        className={view === v ? 'on' : ''}
                        onClick={() => setView(v)}
                      >
                        {v === 'changes' ? 'Changes since' : 'Preview'}
                      </button>
                    ))}
                  </div>
                  {canRestore && (
                    <button type="button" className="btn btn-primary" onClick={restore} disabled={busy}>
                      <Icon name="history" /> {busy ? 'Restoring…' : 'Restore this version'}
                    </button>
                  )}
                </div>
                {resourceKind === 'document' ? (
                  <DocumentVersion snapshot={version.snapshot} current={current} view={view} />
                ) : (
                  <DiagramVersion snapshot={version.snapshot} current={current} view={view} />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </SubPage>
  );
}

function DocumentVersion({
  snapshot,
  current,
  view,
}: {
  snapshot: Record<string, any>;
  current: Props['current'];
  view: 'changes' | 'preview';
}) {
  const then = String(snapshot.content_md ?? '');
  if (view === 'preview') {
    return (
      <div className="history-doc">
        <h2 style={{ marginTop: 0 }}>{snapshot.title}</h2>
        <MarkdownView markdown={then} />
      </div>
    );
  }
  const parts = diffLines(then, current.contentMd ?? '');
  const changed = parts.some((p) => p.added || p.removed) || snapshot.title !== current.title;
  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        <del>red</del> is in this version but not now; <ins>green</ins> was added since. Restoring removes the green and
        brings back the red.
      </p>
      {snapshot.title !== current.title && (
        <div className="diff-row">
          <span className="diff-label">Title</span>
          <del>{snapshot.title}</del> <ins>{current.title}</ins>
        </div>
      )}
      {!changed ? (
        <p className="muted">Identical to the current version.</p>
      ) : (
        <pre className="diff-text" style={{ maxHeight: 420 }}>
          {parts.map((part, i) => {
            const cls = part.added ? 'diff-add' : part.removed ? 'diff-del' : 'diff-same';
            const mark = part.added ? '+ ' : part.removed ? '- ' : '  ';
            const lines = part.value.replace(/\n$/, '').split('\n');
            const shown =
              !part.added && !part.removed && lines.length > 6
                ? [...lines.slice(0, 2), `… ${lines.length - 4} unchanged lines …`, ...lines.slice(-2)]
                : lines;
            return shown.map((line, j) => (
              <div className={cls} key={`${i}-${j}`}>
                {line.startsWith('…') ? line : mark + line}
              </div>
            ));
          })}
        </pre>
      )}
    </div>
  );
}

function DiagramVersion({
  snapshot,
  current,
  view,
}: {
  snapshot: Record<string, any>;
  current: Props['current'];
  view: 'changes' | 'preview';
}) {
  const then = useMemo(
    () => ((snapshot.elements ?? []) as Record<string, unknown>[]).map(normalizeElement),
    [snapshot],
  );
  const diff = useMemo(() => diffElements(then, current.elements ?? []), [then, current.elements]);
  if (view === 'preview') {
    return (
      <div className="history-diagram">
        <DiagramViewer elements={then} label="Diagram as it was in this version" />
      </div>
    );
  }
  const total = diff.added.length + diff.removed.length + diff.changed.length;
  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        What changed between this version and now. Restoring undoes these.
      </p>
      {total === 0 ? (
        <p className="muted">Same shapes as the current diagram.</p>
      ) : (
        <ul className="history-changes">
          {diff.removed.map((e) => (
            <li key={`r${e.id}`}>
              <del>removed since</del> {describeElement(e)}
            </li>
          ))}
          {diff.added.map((e) => (
            <li key={`a${e.id}`}>
              <ins>added since</ins> {describeElement(e)}
            </li>
          ))}
          {diff.changed.map((c) => (
            <li key={`c${c.id}`}>
              <span className="diff-chg">changed</span> {describeElement(c.after)}{' '}
              <span className="muted">({c.fields.join(', ')})</span>
            </li>
          ))}
        </ul>
      )}
      <div className="history-diagram" style={{ height: 240 }}>
        <DiagramViewer elements={then} controls={false} label="Diagram as it was in this version" />
      </div>
    </div>
  );
}
