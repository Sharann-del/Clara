import { diffLines } from 'diff';
import { describeElement, diffElements } from '@clara/shared/diff';
import type { DiagramElement } from '@clara/shared/dsl';
import type { DiagramFields, DocumentFields, PendingChange } from '../lib/api';

/** Readable diff of one pending change: text diff for documents, added/changed/removed elements for diagrams. */

function ScalarRow({ label, before, after }: { label: string; before?: string; after: string }) {
  return (
    <div className="diff-row">
      <span className="diff-label">{label}</span>
      {before !== undefined && <del>{before || '(empty)'}</del>}
      <ins>{after || '(empty)'}</ins>
    </div>
  );
}

const sameList = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

function TextDiff({ before, after }: { before: string; after: string }) {
  const parts = diffLines(before, after);
  return (
    <pre className="diff-text">
      {parts.map((part, i) => {
        const cls = part.added ? 'diff-add' : part.removed ? 'diff-del' : 'diff-same';
        const mark = part.added ? '+ ' : part.removed ? '- ' : '  ';
        const lines = part.value.replace(/\n$/, '').split('\n');
        // Collapse long unchanged runs to keep the review focused on what moved.
        const shown = !part.added && !part.removed && lines.length > 6
          ? [...lines.slice(0, 2), `  … ${lines.length - 4} unchanged lines …`, ...lines.slice(-2)]
          : lines;
        return shown.map((line, j) => (
          <div className={cls} key={`${i}-${j}`}>
            {line.startsWith('  …') ? line : mark + line}
          </div>
        ));
      })}
    </pre>
  );
}

function DocumentDiff({ change }: { change: PendingChange }) {
  const proposed = change.diff_payload.proposed as Partial<DocumentFields>;
  const base = (change.operation === 'update'
    ? change.current ?? (change.diff_payload.base as DocumentFields | undefined)
    : undefined) as DocumentFields | undefined;
  const created = change.operation === 'create';

  const rows: JSX.Element[] = [];
  if (proposed.title !== undefined && proposed.title !== base?.title) {
    rows.push(<ScalarRow key="t" label="Title" before={base?.title} after={proposed.title} />);
  }
  if (proposed.tags !== undefined && !sameList(proposed.tags, base?.tags ?? [])) {
    rows.push(
      <ScalarRow key="g" label="Tags" before={base ? base.tags.join(', ') : undefined} after={proposed.tags.join(', ')} />,
    );
  }
  const body = proposed.contentMd !== undefined && proposed.contentMd !== base?.contentMd;
  return (
    <>
      {rows}
      {body && <TextDiff before={created ? '' : base?.contentMd ?? ''} after={proposed.contentMd!} />}
      {rows.length === 0 && !body && <p className="muted">No visible differences.</p>}
    </>
  );
}

function ElementLine({ el, mark }: { el: DiagramElement; mark: '+' | '-' | '~' }) {
  return (
    <span className={mark === '+' ? 'diff-add' : mark === '-' ? 'diff-del' : 'diff-chg'}>
      {mark} {describeElement(el)}
    </span>
  );
}

function Value({ v }: { v: unknown }) {
  return <code>{typeof v === 'string' ? v : JSON.stringify(v)}</code>;
}

function DiagramDiff({ change }: { change: PendingChange }) {
  const proposed = change.diff_payload.proposed as {
    name?: string; tags?: string[]; parentDiagramId?: string | null; elements?: DiagramElement[];
    source?: { format: string };
  };
  const created = change.operation === 'create';
  const base = (created ? undefined : change.current ?? change.diff_payload.base) as DiagramFields | undefined;
  const d = proposed.elements ? diffElements(base?.elements ?? [], proposed.elements) : undefined;

  return (
    <>
      {proposed.name !== undefined && proposed.name !== base?.name && (
        <ScalarRow label="Name" before={base?.name} after={proposed.name} />
      )}
      {proposed.tags !== undefined && !sameList(proposed.tags, base?.tags ?? []) && (
        <ScalarRow label="Tags" before={base ? base.tags.join(', ') : undefined} after={proposed.tags.join(', ')} />
      )}
      {'parentDiagramId' in proposed && (created ? !!proposed.parentDiagramId : true) && (
        <div className="diff-row">
          <span className="diff-label">Parent diagram</span>
          <ins>{proposed.parentDiagramId ? <code>{proposed.parentDiagramId}</code> : 'top level'}</ins>
        </div>
      )}
      {proposed.source && <div className="diff-row"><span className="diff-label">Source</span><ins>{proposed.source.format} source replaced</ins></div>}
      {d && (
        <div className="diff-elements">
          <div className="muted" style={{ marginBottom: 4 }}>
            {d.added.length} added · {d.changed.length} changed · {d.removed.length} removed
            {d.unchangedCount > 0 && ` · ${d.unchangedCount} unchanged`}
          </div>
          {d.added.map((e) => (
            <div key={e.id} className="diff-el"><ElementLine el={e} mark="+" /></div>
          ))}
          {d.changed.map((c) => (
            <div key={c.id} className="diff-el">
              <ElementLine el={c.after} mark="~" />
              {c.fields.map((f) => (
                <div key={f} className="diff-field">
                  {f === 'geometry' || f === 'style' ? (
                    // Show only the keys that moved inside geometry/style.
                    Object.keys({ ...c.before[f], ...c.after[f] })
                      .filter((k) => JSON.stringify((c.before[f] as any)?.[k]) !== JSON.stringify((c.after[f] as any)?.[k]))
                      .map((k) => (
                        <div key={k}>
                          {f}.{k}: <del><Value v={(c.before[f] as any)?.[k] ?? '—'} /></del> → <ins><Value v={(c.after[f] as any)?.[k] ?? '—'} /></ins>
                        </div>
                      ))
                  ) : (
                    <div>
                      {f}: <del><Value v={c.before[f] ?? '—'} /></del> → <ins><Value v={c.after[f] ?? '—'} /></ins>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
          {d.removed.map((e) => (
            <div key={e.id} className="diff-el"><ElementLine el={e} mark="-" /></div>
          ))}
        </div>
      )}
    </>
  );
}

export function ChangeDiff({ change }: { change: PendingChange }) {
  return change.resource_type === 'document' ? <DocumentDiff change={change} /> : <DiagramDiff change={change} />;
}
