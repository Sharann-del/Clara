import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LogoGlyph } from '../components/site/Logo';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <main id="main" className="auth-card" tabIndex={-1}>
        <Link to="/" className="logo" aria-label="Clara home" style={{ alignSelf: 'flex-start' }}>
          <LogoGlyph size={30} />
        </Link>
        {children}
      </main>
    </div>
  );
}
