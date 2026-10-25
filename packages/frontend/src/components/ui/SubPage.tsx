import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';

interface Props {
  title: string;
  /** One line under the title. */
  description?: ReactNode;
  /** Where "Back" goes when there's no in-app history to return to. */
  backTo: string;
  backLabel?: string;
  children?: ReactNode;
  size?: 'md' | 'lg';
}

/** Back navigation that prefers the previous in-app page, else a fixed parent route. */
export function useBack(fallback: string) {
  const navigate = useNavigate();
  const location = useLocation();
  return () => (location.key !== 'default' ? navigate(-1) : navigate(fallback));
}

/**
 * A full page for what used to be a modal (members, history, sharing, review): it lives at its
 * own URL, so it can be linked, refreshed and left with the browser's Back button.
 */
export function SubPage({ title, description, backTo, backLabel = 'Back', children, size = 'md' }: Props) {
  const back = useBack(backTo);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus({ preventScroll: true }), []);

  return (
    <div className={`subpage subpage-${size}`}>
      <div className="subpage-head">
        <button type="button" className="btn btn-ghost btn-sm subpage-back" onClick={back}>
          <Icon name="arrowLeft" size={14} /> {backLabel}
        </button>
        <h1 ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        {description && <p className="subpage-desc">{description}</p>}
      </div>
      <div className="subpage-body">{children}</div>
    </div>
  );
}
