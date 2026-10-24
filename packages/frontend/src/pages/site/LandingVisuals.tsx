import { useEffect, useMemo, useState } from 'react';
import type { DiagramElement } from '@clara/shared/dsl';
import { DiagramViewer } from '../../components/DiagramViewer';
import { Icon } from '../../components/ui/Icon';
import { compileDiagram } from '../../lib/diagramFromCode';

const usePrefersReducedMotion = () => {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduced;
};

const compile = (code: string) => compileDiagram(code, 'clara').elements;

/** Markdown with a live diagram embedded in it. */
export function DocsVisual() {
  const els = useMemo(() => compile('direction LR\nnode c "Client"\nnode g "Gateway"\nnode s "Search"\nedge c -> g\nedge g -> s "query"'), []);
  return (
    <div className="feature-visual">
      <div className="visual-bar">
        <Icon name="doc" size={14} /> search-design.md
      </div>
      <div className="mini-doc">
        <h4>Search: request path</h4>
        <p style={{ margin: 0, color: 'var(--ink-2)' }}>
          Queries enter through the gateway, which applies rate limits before fanning out to the search tier.
        </p>
        <div className="embed">
          <DiagramViewer elements={els} controls={false} className="viewer-inline" maxFitScale={0.9} label="Embedded diagram: Client to Gateway to Search" />
        </div>
        <p style={{ margin: 0, color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          ```clara-diagram  ·  renders the live diagram
        </p>
      </div>
    </div>
  );
}

const MERMAID = `flowchart TD
  user([User]) --> app[Web app]
  app -->|JWT| api[API]
  api --> db[(Postgres)]`;

/** Mermaid in, editable canvas out. */
export function CodeVisual() {
  const els = useMemo(() => compileDiagram(MERMAID, 'mermaid').elements, []);
  return (
    <div className="feature-visual">
      <div className="visual-bar">
        <Icon name="code" size={14} /> Mermaid import
      </div>
      <div className="split-visual">
        <pre className="code-snippet">
          <span className="k">flowchart</span> TD{'\n'}
          {'  '}user([User]) <span className="k">--&gt;</span> app[Web app]{'\n'}
          {'  '}app <span className="k">--&gt;</span>|JWT| api[API]{'\n'}
          {'  '}api <span className="k">--&gt;</span> db[(Postgres)]
        </pre>
        <div className="visual-body">
          <DiagramViewer elements={els} controls={false} className="viewer-inline" maxFitScale={0.85} />
        </div>
      </div>
    </div>
  );
}

const LEVELS: Record<string, { name: string; code: string; links: Record<string, string> }> = {
  context: {
    name: 'System context',
    code: 'node cust "Customer"\nnode shop "Online shop"\nnode pay "Payment provider"\nedge cust -> shop "orders"\nedge shop -> pay "charges"',
    links: { 'Online shop': 'containers' },
  },
  containers: {
    name: 'Online shop',
    code: 'direction LR\nnode spa "Storefront SPA"\nnode api "Shop API"\nnode db "Orders DB"\nedge spa -> api "JSON"\nedge api -> db "SQL"',
    links: { 'Shop API': 'components' },
  },
  components: {
    name: 'Shop API',
    code: 'direction LR\nnode ctl "Order controller"\nnode svc "Pricing service"\nnode repo "Order repository"\nedge ctl -> svc\nedge ctl -> repo',
    links: {},
  },
};

/** Click a shape with the corner badge to drill down a level, like a real C4 diagram in Clara. */
export function C4Visual() {
  const [path, setPath] = useState<string[]>(['context']);
  const current = LEVELS[path[path.length - 1]];
  const els = useMemo<DiagramElement[]>(
    () =>
      compile(current.code).map((e) => {
        const link = current.links[String(e.geometry.text)];
        return link ? { ...e, linkedDiagramId: link, style: { ...e.style, stroke: '#2b50e8' } } : e;
      }),
    [current],
  );
  return (
    <div className="feature-visual">
      <div className="visual-bar">
        <Icon name="layers" size={14} />
        <nav className="crumbs" aria-label="Diagram level">
          {path.map((id, i) =>
            i === path.length - 1 ? (
              <span key={id} className="here" aria-current="page">
                {LEVELS[id].name}
              </span>
            ) : (
              <span key={id}>
                <button type="button" onClick={() => setPath(path.slice(0, i + 1))}>
                  {LEVELS[id].name}
                </button>
                <Icon name="chevronRight" size={12} />
              </span>
            ),
          )}
        </nav>
      </div>
      <div className="visual-body">
        <DiagramViewer
          elements={els}
          controls={false}
          className="viewer-inline"
          maxFitScale={1}
          onDrillDown={(id) => setPath((p) => [...p, id])}
        />
        {path.length < 3 && <span className="visual-hint">Click the blue box to go a level deeper</span>}
        {path.length === 3 && (
          <button type="button" className="btn btn-sm visual-hint" style={{ pointerEvents: 'auto' }} onClick={() => setPath(['context'])}>
            Back to the top
          </button>
        )}
      </div>
    </div>
  );
}

const MIGRATION = `direction LR
node users "Users"
node mono "Monolith"
node db "Shared DB"
node billing "Billing service"
node events "Event bus"
node bdb "Billing DB"
edge users -> mono "requests"
edge mono -> db "SQL"
edge mono -> billing "calls"
edge billing -> db "SQL (shared)"
edge mono -> events "publishes"
edge events -> billing "consumes"
edge billing -> bdb "SQL (own)"`;

const STATES: { name: string; nodes: string[]; edges: string[] }[] = [
  { name: 'Today', nodes: ['Users', 'Monolith', 'Shared DB'], edges: ['requests', 'SQL'] },
  { name: 'Migrating', nodes: ['Users', 'Monolith', 'Shared DB', 'Billing service'], edges: ['requests', 'SQL', 'calls', 'SQL (shared)'] },
  {
    name: 'Target',
    nodes: ['Users', 'Monolith', 'Shared DB', 'Billing service', 'Event bus', 'Billing DB'],
    edges: ['requests', 'SQL', 'publishes', 'consumes', 'SQL (own)'],
  },
];

/** Named states over one diagram: the same layout, different elements visible. */
export function StatesVisual() {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const base = useMemo(() => compile(MIGRATION), []);

  useEffect(() => {
    if (reduced || paused) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % STATES.length), 2800);
    return () => clearTimeout(t);
  }, [index, reduced, paused]);

  const state = STATES[index];
  const els = useMemo(
    () =>
      base.map((e) => ({
        ...e,
        hidden: e.type === 'connector' ? !state.edges.includes(String(e.geometry.text)) : !state.nodes.includes(String(e.geometry.text)),
      })),
    [base, state],
  );

  return (
    <div className="feature-visual" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)}>
      <div className="visual-bar" role="group" aria-label="Diagram states">
        <Icon name="play" size={12} />
        {STATES.map((s, i) => (
          <button
            key={s.name}
            type="button"
            className={`state-chip ${i === index ? 'active' : ''}`}
            aria-pressed={i === index}
            onClick={() => {
              setIndex(i);
              setPaused(true);
            }}
          >
            {s.name}
          </button>
        ))}
      </div>
      <div className="visual-body">
        <DiagramViewer elements={els} controls={false} className="viewer-inline" maxFitScale={0.95} autoFit={false} label={`Migration diagram, state: ${state.name}`} />
      </div>
    </div>
  );
}

/** Live cursors and presence over a shared diagram. */
export function CollabVisual() {
  const els = useMemo(() => compile('direction LR\nnode a "Ingest"\nnode b "Stream processor"\nnode c "Warehouse"\nedge a -> b\nedge b -> c "hourly"'), []);
  return (
    <div className="feature-visual">
      <div className="visual-bar">
        <Icon name="diagram" size={14} /> pipeline
        <span className="presence-row" aria-label="3 people viewing">
          <span className="avatar" style={{ background: '#db2777' }}>DK</span>
          <span className="avatar" style={{ background: '#0f7a56' }}>SM</span>
          <span className="avatar" style={{ background: '#2b50e8' }}>You</span>
        </span>
      </div>
      <div className="visual-body" aria-hidden="true">
        <DiagramViewer elements={els} controls={false} className="viewer-inline" maxFitScale={0.9} />
        <div className="cursor cursor-a">
          <CursorArrow color="#db2777" />
          <span style={{ background: '#db2777' }}>Dhriti</span>
        </div>
        <div className="cursor cursor-b">
          <CursorArrow color="#0f7a56" />
          <span style={{ background: '#0f7a56' }}>Sam</span>
        </div>
      </div>
    </div>
  );
}

function CursorArrow({ color }: { color: string }) {
  return (
    <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
      <path d="M1 1l13 6.5-5.5 1.6L6 15z" fill={color} stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

/** One command connects Claude; its edits arrive as proposals. */
export function McpVisual({ mcpUrl }: { mcpUrl: string }) {
  return (
    <div className="feature-visual">
      <div className="visual-bar">
        <Icon name="sparkles" size={14} /> Terminal
      </div>
      <pre className="terminal">
        <span className="prompt">$</span> claude mcp add --transport http clara {mcpUrl} \{'\n'}
        {'    '}--header "Authorization: Bearer clara_pat_…"{'\n'}
        <span className="dim">Added HTTP MCP server clara</span>
        {'\n\n'}
        <span className="prompt">&gt;</span> Add a CDN in front of the storefront in the shop diagram{'\n'}
        <span className="dim">● clara · update_diagram → pending_review (needs approval in Clara)</span>
      </pre>
      <div style={{ padding: 14, display: 'grid', gap: 8 }}>
        <div className="change-card" style={{ marginTop: 0 }}>
          <div className="change-head" style={{ marginBottom: 2 }}>
            <span>
              <span className="tag tag-amber">edit diagram</span> <strong>Online shop</strong>
            </span>
            <span className="muted">just now</span>
          </div>
          <div className="diff-el">
            <ins>+ rect "CDN"</ins> <ins>+ connector</ins> <span className="diff-chg">~ connector "JSON"</span>
          </div>
        </div>
      </div>
    </div>
  );
}
