import { Link } from 'react-router-dom';

export function NoAccess({ what, notFound }: { what: string; notFound?: boolean }) {
  return (
    <div style={{ padding: 24, maxWidth: 480 }}>
      <h3>{notFound ? `This ${what} doesn't exist` : `You don't have access to this ${what}`}</h3>
      <p className="muted">
        {notFound
          ? 'It may have been deleted, or the link is wrong.'
          : 'Ask a workspace admin to invite you with your sign-in email, then reload this page.'}
      </p>
      <Link to="/">← Back to workspaces</Link>
    </div>
  );
}
