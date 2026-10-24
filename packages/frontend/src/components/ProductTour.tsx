import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Icon } from './ui/Icon';

export interface TourStep {
  /** `[data-tour="…"]` value of the element to point at; steps whose target is missing are skipped. */
  target: string;
  title: string;
  body: string;
}

const KEY = 'clara.tour.v1';

export function tourDone(): boolean {
  try {
    return localStorage.getItem(KEY) === 'done';
  } catch {
    return true;
  }
}

function markDone() {
  try {
    localStorage.setItem(KEY, 'done');
  } catch {
    // ignore
  }
}

/** A short, skippable coach-mark tour. Esc or "Skip tour" ends it for good. */
export function ProductTour({ steps, onDone }: { steps: TourStep[]; onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const visible = steps.filter((s) => document.querySelector(`[data-tour="${s.target}"]`));
  const step = visible[index];

  const measure = useCallback(() => {
    const el = step && document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  const finish = useCallback(() => {
    markDone();
    onDone();
  }, [onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  useEffect(() => {
    if (!step) finish();
  }, [step, finish]);
  if (!step || !rect) return null;

  // Place the card beside the target: right of it if there's room, else below.
  const pad = 8;
  const cardW = 300;
  const right = rect.right + 16 + cardW < window.innerWidth;
  const top = Math.max(12, Math.min(window.innerHeight - 200, right ? rect.top : rect.bottom + 12));
  const left = right ? rect.right + 16 : Math.max(12, Math.min(window.innerWidth - cardW - 12, rect.left));

  return (
    <div className="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-describedby="tour-body">
      <div
        className="tour-ring"
        style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
        aria-hidden="true"
      />
      <div className="tour-card" style={{ top, left, width: cardW }}>
        <div className="tour-step">
          Tip {index + 1} of {visible.length}
        </div>
        <h2 id="tour-title" className="tour-title">
          {step.title}
        </h2>
        <p id="tour-body" className="tour-body">
          {step.body}
        </p>
        <div className="tour-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={finish}>
            Skip tour
          </button>
          <span style={{ flex: 1 }} />
          {index > 0 && (
            <button type="button" className="btn btn-sm" onClick={() => setIndex(index - 1)}>
              Back
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            autoFocus
            onClick={() => (index === visible.length - 1 ? finish() : setIndex(index + 1))}
          >
            {index === visible.length - 1 ? 'Done' : 'Next'} {index < visible.length - 1 && <Icon name="arrowRight" size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
}
