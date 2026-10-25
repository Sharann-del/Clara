import { useCallback, useEffect, useState } from 'react';
import { SubPage } from './ui/SubPage';
import { Icon } from './ui/Icon';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmProvider';
import { SkeletonRows } from './EmptyState';
import { api, errorMessage, isMissingRoute, type Grant, type ShareLink } from '../lib/api';

interface Props {
  open: boolean;
  kind: 'document' | 'diagram';
  id: string;
  name: string;
  workspaceName?: string;
  /** Editors can change sharing; viewers see who has access. */
  canManage: boolean;
  /** Where "Back" falls back to. */
  backTo: string;
}

export const publicUrl = (token: string) => `${window.location.origin}/s/${token}`;

/** Per-item access for specific people, plus a revocable read-only public link. */
export function ShareDialog({ open, kind, id, name, workspaceName, canManage, backTo }: Props) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [unsupported, setUnsupported] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [g, l] = await Promise.all([api.listGrants(kind, id), api.listShareLinks(kind, id)]);
      setGrants(g);
      setLinks(l);
    } catch (e) {
      if (isMissingRoute(e)) setUnsupported(true);
      else setError(errorMessage(e));
      setGrants([]);
    }
  }, [kind, id]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.grant(kind, id, email.trim(), role);
      toast.success(`Shared with ${email.trim()} as ${role}`);
      setEmail('');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function createLink() {
    try {
      const link = await api.createShareLink(kind, id);
      await navigator.clipboard?.writeText(publicUrl(link.token)).catch(() => undefined);
      toast.success('Public link created and copied');
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function revokeLink(link: ShareLink) {
    const ok = await confirm({
      title: 'Turn off this public link?',
      message: 'Anyone who has it will see “link no longer works”. You can create a new link later.',
      confirmLabel: 'Turn off link',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.revokeShareLink(link.id);
      toast.success('Public link turned off');
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (!open) return null;
  return (
    <SubPage title={`Share “${name}”`} description="Who can open it, and whether there’s a public read-only link." backTo={backTo}>
      {unsupported ? (
        <p className="muted" style={{ fontSize: 14 }}>
          Sharing single items needs a newer Clara API than this one. Until it's deployed, invite people to the workspace from
          Members.
        </p>
      ) : grants === null ? (
        <SkeletonRows rows={2} />
      ) : (
        <>
          <section className="share-section" aria-labelledby="share-people">
            <h3 id="share-people">People with access</h3>
            <div className="member-row">
              <span className="ws-avatar" aria-hidden="true">
                <Icon name="users" size={12} />
              </span>
              <span className="member-email">Members of {workspaceName ?? 'the workspace'}</span>
              <span className="tag tag-neutral">their workspace role</span>
            </div>
            {grants.map((g) => (
              <div className="member-row" key={g.user_id}>
                <span className="ws-avatar user" aria-hidden="true">
                  {(g.email ?? '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="member-email">
                  {g.email ?? g.user_id}
                  {g.workspace_role && <span className="muted"> · also {g.workspace_role} of the workspace</span>}
                </span>
                {canManage ? (
                  <>
                    <select
                      className="input"
                      aria-label={`Access for ${g.email ?? g.user_id}`}
                      value={g.role}
                      onChange={async (e) => {
                        try {
                          await api.changeGrant(kind, id, g.user_id, e.target.value as 'viewer' | 'editor');
                          await load();
                        } catch (err) {
                          toast.error(errorMessage(err));
                        }
                      }}
                    >
                      <option value="viewer">Can view</option>
                      <option value="editor">Can edit</option>
                    </select>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm btn-danger"
                      aria-label={`Remove access for ${g.email ?? g.user_id}`}
                      onClick={async () => {
                        try {
                          await api.revokeGrant(kind, id, g.user_id);
                          toast.success(`Removed access for ${g.email ?? 'that person'}`);
                          await load();
                        } catch (err) {
                          toast.error(errorMessage(err));
                        }
                      }}
                    >
                      <Icon name="x" />
                    </button>
                  </>
                ) : (
                  <span className="tag tag-neutral">{g.role === 'editor' ? 'can edit' : 'can view'}</span>
                )}
              </div>
            ))}
            {canManage && (
              <form onSubmit={add} className="invite-row">
                <label className="field" style={{ flex: 1 }}>
                  Add a person
                  <input className="input" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </label>
                <label className="field">
                  Access
                  <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'viewer' | 'editor')}>
                    <option value="viewer">Can view</option>
                    <option value="editor">Can edit</option>
                  </select>
                </label>
                <button className="btn btn-primary" type="submit" disabled={busy} style={{ alignSelf: 'flex-end' }}>
                  {busy ? 'Sharing…' : 'Share'}
                </button>
              </form>
            )}
            <p className="field-hint" style={{ margin: '6px 0 0' }}>
              People you add see only this {kind}, not the rest of the workspace. They need a Clara account.
            </p>
          </section>

          <section className="share-section" aria-labelledby="share-public">
            <h3 id="share-public">Public link</h3>
            {links.length === 0 ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span className="muted" style={{ fontSize: 13.5 }}>
                  Off. Anyone with a link could view this {kind} without signing in.
                </span>
                {canManage && (
                  <button type="button" className="btn" onClick={createLink}>
                    <Icon name="globe" /> Create public link
                  </button>
                )}
              </div>
            ) : (
              links.map((l) => (
                <div key={l.id} className="share-link-row">
                  <label className="sr-only" htmlFor={`link-${l.id}`}>
                    Public link
                  </label>
                  <input id={`link-${l.id}`} className="input" readOnly value={publicUrl(l.token)} onFocus={(e) => e.currentTarget.select()} />
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(publicUrl(l.token))
                        .then(() => toast.success('Link copied'))
                        .catch(() => toast.error('Couldn’t copy; select the link and copy it'))
                    }
                  >
                    <Icon name="copy" /> Copy
                  </button>
                  {canManage && (
                    <button type="button" className="btn btn-danger" onClick={() => revokeLink(l)}>
                      Turn off
                    </button>
                  )}
                </div>
              ))
            )}
            {links.length > 0 && (
              <p className="field-hint" style={{ margin: '6px 0 0' }}>
                Read-only. {kind === 'document' ? 'Diagrams embedded in the document are visible through the link too.' : 'Linked child diagrams need their own links.'}
              </p>
            )}
          </section>
        </>
      )}
      {error && (
        <div className="error-text" role="alert">
          {error}
        </div>
      )}
    </SubPage>
  );
}
