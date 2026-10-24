import { Link } from 'react-router-dom';

/** Glyph: a parent box with a child box drilled out of its corner (C4 drill-down). */
export function LogoGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <rect x="6.5" y="6.5" width="10" height="8" rx="2" fill="none" stroke="var(--paper)" strokeWidth="2" />
      <path d="M11.5 14.5v4.5a2 2 0 0 0 2 2h3" fill="none" stroke="var(--paper)" strokeWidth="2" strokeLinecap="round" />
      <rect x="16.5" y="17" width="9" height="8" rx="2" fill="var(--cobalt)" />
    </svg>
  );
}

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo" aria-label="Clara home">
      <LogoGlyph />
      <span className="logo-word">clara</span>
    </Link>
  );
}
