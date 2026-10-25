import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Logo } from './Logo';
import { Icon } from '../ui/Icon';
import { useAuth } from '../../context/AuthContext';

const NAV = [
  { to: '/editor', label: 'Playground' },
  { to: '/docs', label: 'Docs' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/about', label: 'About' },
];

export function SiteHeader() {
  const { idToken } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Logo />
        <nav className={`site-nav ${open ? 'open' : ''}`} id="site-nav" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className="site-nav-link">
              {n.label}
            </NavLink>
          ))}
          <div className="site-nav-mobile-cta show-mobile">
            {idToken ? (
              <Link to="/app" className="btn btn-primary btn-lg">Open Clara</Link>
            ) : (
              <>
                <Link to="/signin" className="btn btn-lg">Sign in</Link>
                <Link to="/signup" className="btn btn-primary btn-lg">Start free</Link>
              </>
            )}
          </div>
        </nav>
        <div className="site-header-actions">
          {idToken ? (
            <Link to="/app" className="btn btn-primary hide-mobile">
              Open Clara <Icon name="arrowRight" size={14} />
            </Link>
          ) : (
            <>
              <Link to="/signin" className="btn btn-ghost hide-mobile">Sign in</Link>
              <Link to="/signup" className="btn btn-primary hide-mobile">Start free</Link>
            </>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-icon show-mobile"
            aria-expanded={open}
            aria-controls="site-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name={open ? 'x' : 'menu'} size={20} />
          </button>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <Logo />
          <p className="muted">System design docs, diagrams as code, and AI edits you approve.</p>
        </div>
        <nav aria-label="Product" className="site-footer-col">
          <h2>Product</h2>
          <Link to="/editor">Playground</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/signup">Create an account</Link>
        </nav>
        <nav aria-label="Documentation" className="site-footer-col">
          <h2>Docs</h2>
          <Link to="/docs/getting-started">Getting started</Link>
          <Link to="/docs/dsl">DSL reference</Link>
          <Link to="/docs/mermaid">Mermaid support</Link>
          <Link to="/docs/mcp">MCP setup</Link>
          <Link to="/docs/shortcuts">Keyboard shortcuts</Link>
        </nav>
        <nav aria-label="Company" className="site-footer-col">
          <h2>Clara</h2>
          <Link to="/about">About</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </div>
      <div className="site-footer-base">
        <span>© {new Date().getFullYear()} Clara</span>
        <span>Hosted on AWS in Stockholm (eu-north-1)</span>
      </div>
    </footer>
  );
}

export function SiteLayout({ children, bare }: { children: ReactNode; bare?: boolean }) {
  return (
    <div className="site">
      <a href="#main" className="skip-link">Skip to content</a>
      <SiteHeader />
      <main id="main" className="site-main" tabIndex={-1}>
        {children}
      </main>
      {!bare && <SiteFooter />}
    </div>
  );
}
