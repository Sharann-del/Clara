import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DiagramViewer } from './DiagramViewer';
import { Icon } from './ui/Icon';
import { api, ApiError, normalizeElement, type DiagramElement } from '../lib/api';

interface Loaded {
  name: string;
  elements: DiagramElement[];
}

// Several embeds of the same diagram on a page share one request; entries expire so embeds stay live.
const cache = new Map<string, { at: number; p: Promise<Loaded> }>();
const TTL_MS = 15_000;

function load(id: string, token?: string): Promise<Loaded> {
  const key = `${token ?? ''}:${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = (token ? api.getPublicDiagram(token, id) : api.getDiagram(id)).then((d) => ({
    name: d.name,
    elements: (d.elements as Record<string, unknown>[]).map(normalizeElement),
  }));
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));
  return p;
}

/** A live, read-only diagram inside a markdown document. */
export function DiagramEmbed({ id, height = 320, publicToken }: { id: string; height?: number; publicToken?: string }) {
  const [state, setState] = useState<{ data?: Loaded; error?: number }>({});
  useEffect(() => {
    let live = true;
    setState({});
    load(id, publicToken)
      .then((data) => live && setState({ data }))
      .catch((e) => live && setState({ error: e instanceof ApiError ? e.status : 0 }));
    return () => {
      live = false;
    };
  }, [id, publicToken]);

  if (state.error !== undefined) {
    return (
      <div className="embed-card embed-missing" role="note">
        <Icon name="diagram" />
        {state.error === 404
          ? 'This embedded diagram was deleted.'
          : state.error === 403
            ? 'You don’t have access to this embedded diagram.'
            : 'This embedded diagram couldn’t be loaded.'}
      </div>
    );
  }
  return (
    <figure className="embed-card" style={{ height }}>
      <figcaption className="embed-head">
        <Icon name="diagram" size={14} />
        <span className="embed-name">{state.data?.name ?? 'Loading diagram…'}</span>
        {!publicToken && state.data && (
          <Link to={`/diagrams/${id}`} className="btn btn-ghost btn-sm">
            Open <Icon name="arrowUpRight" size={12} />
          </Link>
        )}
      </figcaption>
      <div className="embed-body">
        {state.data ? (
          <DiagramViewer
            elements={state.data.elements}
            className="viewer-inline"
            maxFitScale={1}
            label={`Embedded diagram: ${state.data.name}`}
          />
        ) : (
          <span className="skeleton" style={{ position: 'absolute', inset: 0, borderRadius: 0 }} />
        )}
      </div>
    </figure>
  );
}
