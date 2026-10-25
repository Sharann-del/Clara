import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DiagramViewer } from '../../components/DiagramViewer';
import { Icon } from '../../components/ui/Icon';
import { compileDiagram, describeCompile } from '../../lib/diagramFromCode';
import { encodeState } from '../../lib/share';

const BASE = `direction LR
node web "Web app"
node api "Orders API"
node db "Postgres"
node queue "Job queue"
node worker "Worker"
edge web -> api "HTTPS"
edge api -> db "SQL"
edge api -> queue "enqueue"
edge queue -> worker`;

const PROPOSAL = {
  title: 'Cache order reads in Redis',
  summary: 'Order reads dominate; caching them takes load off the database.',
  lines: ['node cache "Redis cache"', 'edge api -> cache "cache-aside"'],
  addedLabels: new Set(['Redis cache']),
};

type Phase = 'waiting' | 'pending' | 'stale' | 'accepted' | 'rejected';

// Accent = proposed and waiting for a human; green = accepted.
const ACCENT = '#8e98ff';
const GREEN = '#4cc79d';

/**
 * The landing hero: a real editor (same parser, layout and renderer as the app). A simulated
 * Claude proposal previews in the accent colour and only lands in the code when the visitor accepts it,
 * which is exactly how MCP edits work in Clara.
 */
export function HeroDemo() {
  const [code, setCode] = useState(BASE);
  const [phase, setPhase] = useState<Phase>('waiting');
  const [flash, setFlash] = useState(false);
  /** Code as it was when Claude proposed; editing it afterwards makes the proposal stale. */
  const [proposedAgainst, setProposedAgainst] = useState(BASE);
  const [shareHref, setShareHref] = useState('/editor');

  useEffect(() => {
    if (phase !== 'waiting') return;
    const t = setTimeout(() => {
      setProposedAgainst(code);
      setPhase('pending');
    }, 1400);
    return () => clearTimeout(t);
  }, [phase, code]);

  useEffect(() => {
    let live = true;
    encodeState({ code, format: 'clara' }).then((h) => live && setShareHref(`/editor#${h}`));
    return () => {
      live = false;
    };
  }, [code]);

  const showPreview = phase === 'pending' || phase === 'stale';
  const compiled = useMemo(
    () => compileDiagram(showPreview ? `${code}\n${PROPOSAL.lines.join('\n')}` : code, 'clara'),
    [code, showPreview],
  );

  const highlights = useMemo(() => {
    if (!showPreview && !flash) return undefined;
    const color = flash ? GREEN : ACCENT;
    const added = new Set(
      compiled.elements
        .filter((e) => e.type !== 'connector' && PROPOSAL.addedLabels.has(String(e.geometry.text)))
        .map((e) => e.id!),
    );
    const out: Record<string, string> = {};
    for (const el of compiled.elements) {
      if (
        added.has(el.id!) ||
        (el.type === 'connector' && (added.has(el.geometry.fromId as string) || added.has(el.geometry.toId as string)))
      ) {
        out[el.id!] = color;
      }
    }
    return out;
  }, [compiled, showPreview, flash]);

  function accept(force = false) {
    if (!force && code !== proposedAgainst) {
      setPhase('stale');
      return;
    }
    setCode((c) => `${c.trimEnd()}\n${PROPOSAL.lines.join('\n')}`);
    setPhase('accepted');
    setFlash(true);
    setTimeout(() => setFlash(false), 1800);
  }

  function reset() {
    setCode(BASE);
    setFlash(false);
    setPhase('waiting');
  }

  return (
    <div
      className="demo"
      role="region"
      aria-label="Interactive demo: edit the diagram code and review an AI-proposed change"
    >
      <div className="demo-bar">
        <Icon name="code" size={14} />
        <span className="demo-file">orders.clara</span>
        <span className="spacer" />
        <span className="demo-live hide-mobile">Re-renders as you type</span>
        <Link to={shareHref} className="btn btn-sm">
          Open in playground <Icon name="arrowUpRight" size={13} />
        </Link>
      </div>
      <div className="demo-grid">
        <div className="demo-code">
          <label htmlFor="hero-code" className="sr-only">
            Diagram code (Clara DSL)
          </label>
          <textarea
            id="hero-code"
            className="code-input"
            value={code}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => setCode(e.target.value)}
          />
          <div className={`code-status ${compiled.issues.length ? 'error' : ''}`} aria-live="polite">
            {describeCompile(compiled)}
          </div>
        </div>
        <div className="demo-stage">
          <DiagramViewer elements={compiled.elements} highlights={highlights} maxFitScale={1.1} />
          {phase !== 'waiting' && (
            <ProposalCard phase={phase} onAccept={accept} onReject={() => setPhase('rejected')} onReset={reset} />
          )}
        </div>
      </div>
    </div>
  );
}

function ProposalCard({
  phase,
  onAccept,
  onReject,
  onReset,
}: {
  phase: Phase;
  onAccept: (force?: boolean) => void;
  onReject: () => void;
  onReset: () => void;
}) {
  if (phase === 'accepted' || phase === 'rejected') {
    return (
      <div className="proposal settled" role="status">
        <div className={`proposal-result ${phase === 'accepted' ? 'ok' : ''}`}>
          <Icon name={phase === 'accepted' ? 'check' : 'x'} />
          <span>
            {phase === 'accepted' ? 'Accepted. The previous version is in history.' : 'Rejected. Nothing changed.'}
          </span>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onReset}>
          <Icon name="undo" size={13} /> Replay the demo
        </button>
      </div>
    );
  }
  return (
    <div className="proposal" role="group" aria-label="Change proposed by Claude, waiting for your review">
      <div className="proposal-who">
        <Icon name="review" size={14} /> Claude proposes
      </div>
      <div className="proposal-title">{PROPOSAL.title}</div>
      <pre className="proposal-diff" aria-label="Proposed additions">
        {PROPOSAL.lines.map((l) => (
          <ins key={l}>+ {l}</ins>
        ))}
      </pre>
      {phase === 'stale' ? (
        <div className="proposal-stale">
          <p className="muted" style={{ margin: '0 0 8px', color: 'var(--cobalt-ink)', maxWidth: 240 }}>
            You edited the diagram after this was proposed. Accept anyway?
          </p>
          <div className="proposal-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onAccept(true)}>
              Accept anyway
            </button>
            <button type="button" className="btn btn-sm" onClick={onReject}>
              Reject
            </button>
          </div>
        </div>
      ) : (
        <div className="proposal-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onAccept()}>
            <Icon name="check" size={14} /> Accept
          </button>
          <button type="button" className="btn btn-sm" onClick={onReject}>
            Reject
          </button>
          <span className="muted">Not applied yet</span>
        </div>
      )}
    </div>
  );
}
