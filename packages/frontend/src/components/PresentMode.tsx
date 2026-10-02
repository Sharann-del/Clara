import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiagramElement, DiagramState } from '../lib/api';
import { buildSteps, easeInOut, interpolate, resolveElements, stepBy, toRender, type RenderEl } from '../lib/states';

interface Props {
  base: DiagramElement[];
  states: DiagramState[];
  startIndex: number;
  onClose: () => void;
}

const TRANSITION_MS = 700;
const num = (v: unknown, f = 0) => (typeof v === 'number' ? v : f);

export function PresentMode({ base, states, startIndex, onClose }: Props) {
  const steps = useMemo(() => buildSteps(states), [states]);
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), steps.length - 1));
  const [playing, setPlaying] = useState(false);
  const [seconds, setSeconds] = useState(3);
  const [loop, setLoop] = useState(true);
  const [frame, setFrame] = useState<RenderEl[]>(() => resolveElements(base, steps[index].state).map(toRender));
  const shown = useRef(frame); // what's currently on screen — the start point of the next transition
  const raf = useRef<number>();

  const targets = useMemo(() => steps.map((s) => resolveElements(base, s.state).map(toRender)), [base, steps]);

  // Animate from whatever is on screen (even mid-transition) to the new state.
  useEffect(() => {
    const target = targets[index];
    if (!target) return;
    const from = shown.current;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / TRANSITION_MS);
      const next = interpolate(from, target, easeInOut(t));
      shown.current = next;
      setFrame(next);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [index, targets]);

  const go = useCallback(
    (dir: -1 | 1) => setIndex((i) => stepBy(i, dir, steps.length)),
    [steps.length],
  );

  // Timed auto-play.
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (index < steps.length - 1) setIndex(index + 1);
      else if (loop) setIndex(0);
      else setPlaying(false);
    }, Math.max(0.5, seconds) * 1000);
    return () => clearTimeout(timer);
  }, [playing, index, seconds, loop, steps.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  // Fixed camera: bounds across ALL states, so nothing jumps or gets clipped between steps.
  const viewBox = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const list of targets) {
      for (const r of list) {
        if (r.el.type === 'connector') continue;
        const w = r.el.type === 'text' ? 120 : r.width;
        const h = r.el.type === 'text' ? 20 : r.height;
        minX = Math.min(minX, r.x); minY = Math.min(minY, r.y - (r.el.type === 'text' ? 14 : 0));
        maxX = Math.max(maxX, r.x + w); maxY = Math.max(maxY, r.y + h);
      }
    }
    if (!isFinite(minX)) return '0 0 800 600';
    const pad = 48;
    return `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
  }, [targets]);

  const byId = new Map(frame.map((r) => [r.el.id, r]));
  const center = (id: unknown) => {
    const r = typeof id === 'string' ? byId.get(id) : undefined;
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : undefined;
  };

  return (
    <div className="present-overlay">
      <div className="present-title">
        <strong>{steps[index]?.name}</strong>
        <span className="muted">
          {index + 1} / {steps.length}
        </span>
      </div>
      <svg className="present-svg" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="present-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#475569" />
          </marker>
        </defs>
        {frame
          .filter((r) => r.el.type !== 'connector')
          .sort((a, b) => a.el.zIndex - b.el.zIndex)
          .map((r) => {
            const { el, x, y, width: w, height: h, opacity } = r;
            const text = String(el.geometry.text ?? '');
            if (el.type === 'text')
              return (
                <text key={el.id} x={x} y={y} opacity={opacity} fontSize={num(el.style.fontSize, 14)} fill={String(el.style.color ?? '#0f172a')}>
                  {text}
                </text>
              );
            if (el.type === 'group')
              return (
                <g key={el.id} opacity={opacity}>
                  <rect x={x} y={y} width={w} height={h} fill="none" stroke="#94a3b8" strokeDasharray="6 4" rx={8} />
                  <text x={x + 8} y={y + 16} fontSize={12} fill="#64748b">{text}</text>
                </g>
              );
            return (
              <g key={el.id} opacity={opacity}>
                {el.type === 'ellipse' ? (
                  <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={r.fill ?? '#fff'} stroke={r.stroke ?? '#1f2937'} strokeWidth={1.5} />
                ) : (
                  <rect x={x} y={y} width={w} height={h} rx={6} fill={r.fill ?? '#fff'} stroke={r.stroke ?? '#1f2937'} strokeWidth={1.5} />
                )}
                <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={13} fill="#0f172a">
                  {text}
                </text>
              </g>
            );
          })}
        {frame
          .filter((r) => r.el.type === 'connector')
          .map((r) => {
            const a = center(r.el.geometry.fromId);
            const b = center(r.el.geometry.toId);
            const p = a && b ? { x1: a.x, y1: a.y, x2: b.x, y2: b.y } : { x1: num(r.el.geometry.x1), y1: num(r.el.geometry.y1), x2: num(r.el.geometry.x2), y2: num(r.el.geometry.y2) };
            return (
              <g key={r.el.id} opacity={r.opacity}>
                <line {...p} stroke="#475569" strokeWidth={1.5} markerEnd="url(#present-arrow)" />
                {Boolean(r.el.geometry.text) && (
                  <text x={(p.x1 + p.x2) / 2} y={(p.y1 + p.y2) / 2 - 4} fontSize={11} fill="#475569" textAnchor="middle">
                    {String(r.el.geometry.text)}
                  </text>
                )}
              </g>
            );
          })}
      </svg>

      <div className="present-controls">
        <button className="btn" disabled={index === 0} onClick={() => go(-1)}>← Prev</button>
        <button className="btn" onClick={() => setPlaying((p) => !p)}>{playing ? '⏸ Pause' : '▶ Auto-play'}</button>
        <button className="btn" disabled={index === steps.length - 1} onClick={() => go(1)}>Next →</button>
        <label className="muted" style={{ fontSize: 12 }}>
          Seconds per state{' '}
          <input type="number" min={0.5} step={0.5} value={seconds} style={{ width: 56 }} onChange={(e) => setSeconds(Number(e.target.value) || 1)} />
        </label>
        <label className="muted" style={{ fontSize: 12 }}>
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop
        </label>
        <button className="btn" onClick={onClose}>Exit (Esc)</button>
      </div>
    </div>
  );
}
