import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Logo } from '../components/site/Logo';
import { ThemeMenu } from '../components/ThemeMenu';
import { DiagramViewer } from '../components/DiagramViewer';
import { MarkdownView } from '../components/MarkdownView';
import { PresentMode } from '../components/PresentMode';
import { EmptyState, SkeletonRows } from '../components/EmptyState';
import { Icon } from '../components/ui/Icon';
import { Menu } from '../components/ui/Menu';
import { useToast } from '../components/ui/Toast';
import { api, ApiError, errorMessage, normalizeElement, type PublicResource } from '../lib/api';
import { resolveElements } from '../lib/states';
import { exportDiagram, type ExportFormat } from '../lib/exporters';
import { usePageMeta } from '../lib/seo';
import { timeAgo } from '../lib/time';

/** Read-only page behind a public share link. No sign-in; nothing but this item is reachable. */
export function PublicViewPage() {
  const { token = '' } = useParams<{ token: string }>();
  const toast = useToast();
  const [data, setData] = useState<PublicResource | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [stateId, setStateId] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);

  useEffect(() => {
    api
      .getPublic(token)
      .then(setData)
      .catch((e) => setError({ status: e instanceof ApiError ? e.status : 0, message: errorMessage(e) }));
  }, [token]);

  const title = data ? (data.kind === 'document' ? data.document.title : data.diagram.name) : undefined;
  usePageMeta(title ?? (error ? 'Link unavailable' : undefined), { noindex: true, description: 'Shared with Clara' });

  const elements = useMemo(() => (data?.kind === 'diagram' ? data.diagram.elements.map(normalizeElement) : []), [data]);
  const states = data?.kind === 'diagram' ? [...data.diagram.states].sort((a, b) => a.order_index - b.order_index) : [];
  const active = states.find((s) => s.id === stateId);
  const shown = useMemo(() => resolveElements(elements, active), [elements, active]);

  async function runExport(format: ExportFormat) {
    try {
      await exportDiagram(shown, `${title ?? 'diagram'}${active ? ` - ${active.name}` : ''}`, format);
    } catch (e) {
      toast.error(`Export failed: ${errorMessage(e)}`);
    }
  }

  return (
    <div className="public">
      <header className="public-bar">
        <Logo />
        <span className="public-note hide-mobile">
          <Icon name="eye" size={14} /> Shared read-only
        </span>
        <span style={{ flex: 1 }} />
        <ThemeMenu />
        <Link to="/editor" className="btn btn-ghost hide-mobile">
          Try the playground
        </Link>
        <Link to="/signup" className="btn btn-primary">
          Make your own
        </Link>
      </header>

      <main id="main" className={`public-main ${data?.kind === 'diagram' ? 'is-diagram' : ''}`} tabIndex={-1}>
        {error ? (
          <div style={{ maxWidth: 520, margin: '12vh auto', padding: '0 16px' }}>
            <EmptyState
              icon="unlink"
              title={error.status === 404 ? 'This link no longer works' : 'This page didn’t load'}
              actions={
                <Link to="/" className="btn btn-primary">
                  What is Clara?
                </Link>
              }
            >
              {error.status === 404 ? 'Whoever shared it may have turned the link off. Ask them for a new one.' : error.message}
            </EmptyState>
          </div>
        ) : !data ? (
          <div className="public-doc">
            <span className="skeleton" style={{ height: 40, width: '55%', marginBottom: 16 }} />
            <SkeletonRows rows={6} height={20} />
          </div>
        ) : data.kind === 'document' ? (
          <article className="public-doc">
            <h1 className="doc-title">{data.document.title}</h1>
            <div className="doc-meta">
              {data.document.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
              <span>Updated {timeAgo(data.document.updated_at)}</span>
            </div>
            <MarkdownView markdown={data.document.content_md} publicToken={token} />
          </article>
        ) : (
          <>
            <div className="public-diagram-bar">
              <h1>{data.diagram.name}</h1>
              {states.length > 0 && (
                <div className="public-states" role="group" aria-label="States">
                  <button type="button" className={`state-chip ${!stateId ? 'active' : ''}`} aria-pressed={!stateId} onClick={() => setStateId(null)}>
                    Base
                  </button>
                  {states.map((s) => (
                    <button key={s.id} type="button" className={`state-chip ${stateId === s.id ? 'active' : ''}`} aria-pressed={stateId === s.id} onClick={() => setStateId(s.id)}>
                      {s.name}
                    </button>
                  ))}
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setPresenting(true)}>
                    <Icon name="play" size={12} /> Present
                  </button>
                </div>
              )}
              <span style={{ flex: 1 }} />
              <Menu
                trigger={
                  <>
                    <Icon name="download" /> Export
                  </>
                }
                label="Export"
                items={[
                  { label: 'SVG image', onSelect: () => runExport('svg') },
                  { label: 'PNG image (2×)', onSelect: () => runExport('png') },
                  { label: 'PDF document', onSelect: () => runExport('pdf') },
                  { label: 'Mermaid source (.mmd)', onSelect: () => runExport('mermaid') },
                ]}
              />
            </div>
            <div className="public-stage">
              <DiagramViewer elements={shown} label={`Diagram: ${data.diagram.name}`} />
            </div>
            {presenting && <PresentMode base={elements} states={states} startIndex={stateId ? states.findIndex((s) => s.id === stateId) + 1 : 0} onClose={() => setPresenting(false)} />}
          </>
        )}
      </main>
    </div>
  );
}
