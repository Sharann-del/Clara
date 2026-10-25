import { Link, useLocation } from 'react-router-dom';
import { SiteLayout } from '../../components/site/SiteLayout';
import { usePageMeta } from '../../lib/seo';
import { useAuth } from '../../context/AuthContext';

export function NotFoundPage() {
  usePageMeta('Page not found', { noindex: true });
  const { pathname } = useLocation();
  const { idToken } = useAuth();
  return (
    <SiteLayout>
      <div className="notfound wrap">
        <span className="code404">
          edge you -&gt; {pathname.length > 40 ? `${pathname.slice(0, 37)}…` : pathname} # no such node
        </span>
        <h1>This page doesn't exist.</h1>
        <p>The link may be old, or the page may have moved. These are good places to pick up from.</p>
        <div className="cta-row">
          <Link to={idToken ? '/app' : '/'} className="btn btn-primary btn-lg">
            {idToken ? 'Go to your workspaces' : 'Go to the home page'}
          </Link>
          <Link to="/editor" className="btn btn-lg">
            Open the playground
          </Link>
          <Link to="/docs" className="btn btn-lg btn-ghost">
            Read the docs
          </Link>
        </div>
      </div>
    </SiteLayout>
  );
}
