import { Link } from 'react-router-dom';
import { EmptyState } from './EmptyState';

export function NoAccess({ what, notFound }: { what: string; notFound?: boolean }) {
  return (
    <div style={{ maxWidth: 520, margin: '14vh auto', padding: '0 16px' }}>
      <EmptyState
        icon={notFound ? 'search' : 'lock'}
        title={notFound ? `This ${what} doesn't exist` : `You don't have access to this ${what}`}
        actions={
          <Link to="/app" className="btn btn-primary">
            Go to your workspaces
          </Link>
        }
      >
        {notFound
          ? 'It may have been deleted, or the link is wrong.'
          : `Ask someone who can edit it to share it with your sign-in email, or to invite you to its workspace.`}
      </EmptyState>
    </div>
  );
}
