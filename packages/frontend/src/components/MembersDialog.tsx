import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SubPage } from './ui/SubPage';
import { Icon } from './ui/Icon';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmProvider';
import { SkeletonRows } from './EmptyState';
import { api, errorMessage, type Member, type Role } from '../lib/api';
import { refreshWorkspaces } from '../lib/useWorkspaces';

const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including deleting the workspace',
  admin: 'Manage members, plus everything editors can do',
  editor: 'Create, edit, delete and review AI changes',
  viewer: 'Read, export and present',
};

interface Props {
  open: boolean;
  workspaceId: string;
  myRole?: Role;
  mySub?: string;
  /** Where "Back" falls back to. */
  backTo: string;
}

export function MembersDialog({ open, workspaceId, myRole, mySub, backTo }: Props) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'editor' | 'viewer'>('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canManage = myRole === 'owner' || myRole === 'admin';

  const refresh = useCallback(() => api.listMembers(workspaceId).then(setMembers).catch((e) => setError(errorMessage(e))), [workspaceId]);
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.inviteMember(workspaceId, email.trim(), role);
      toast.success(`Added ${email.trim()} as ${role}`);
      setEmail('');
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(m: Member, next: Role) {
    try {
      await api.setMemberRole(workspaceId, m.user_id, next);
      toast.success(`${m.email ?? 'Member'} is now ${next === 'admin' || next === 'owner' ? 'an' : 'a'} ${next}`);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
      await refresh();
    }
  }

  async function remove(m: Member) {
    const self = m.user_id === mySub;
    const ok = await confirm({
      title: self ? 'Leave this workspace?' : `Remove ${m.email ?? 'this member'}?`,
      message: self
        ? 'You’ll lose access to its documents and diagrams unless someone invites you back.'
        : 'They’ll lose access to everything in this workspace except items shared with them directly.',
      confirmLabel: self ? 'Leave workspace' : 'Remove member',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.removeMember(workspaceId, m.user_id);
      if (self) {
        await refreshWorkspaces();
        toast.success('You left the workspace');
        navigate('/app');
        return;
      }
      toast.success(`Removed ${m.email ?? 'member'}`);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  // Owners can assign any role; admins can't touch owners or create them.
  const assignable = (m: Member): Role[] =>
    myRole === 'owner' ? ['owner', 'admin', 'editor', 'viewer'] : m.role === 'owner' ? [] : ['admin', 'editor', 'viewer'];

  if (!open) return null;
  return (
    <SubPage title="Members" description="People in this workspace and what they can do." backTo={backTo}>
      <div className="members-layout">
        <div className="members-main">
          {canManage && (
            <section className="card" aria-labelledby="invite-h">
              <div className="card-head">
                <h2 id="invite-h">Invite people</h2>
                <p>They need a Clara account first. They get access to everything in this workspace.</p>
              </div>
              <form onSubmit={invite} className="invite-row">
                <label className="field" style={{ flex: 1 }}>
                  <span className="sr-only">Email</span>
                  <input
                    className="input"
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span className="sr-only">Role</span>
                  <select className="input" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <button className="btn btn-primary" type="submit" disabled={busy}>
                  {busy ? 'Inviting…' : 'Invite'}
                </button>
              </form>
              {error && (
                <div className="error-text" role="alert">
                  {error}
                </div>
              )}
            </section>
          )}

          <section className="card" aria-labelledby="members-h">
            <div className="card-head">
              <h2 id="members-h">
                Members {members && <span className="card-count">{members.length}</span>}
              </h2>
            </div>
            {members === null ? (
              <SkeletonRows rows={3} />
            ) : (
              <ul className="member-list" role="list">
                {members.map((m) => {
                  const self = m.user_id === mySub;
                  const options = assignable(m);
                  return (
                    <li key={m.user_id} className="member-row">
                      <span className="ws-avatar user member-avatar" aria-hidden="true">
                        {(m.email ?? '?').slice(0, 1).toUpperCase()}
                      </span>
                      <span className="member-email">
                        <span className="member-name">
                          {m.email ?? m.user_id}
                          {self && <span className="muted"> (you)</span>}
                        </span>
                        <span className="member-role-help">{ROLE_HELP[m.role]}</span>
                      </span>
                      {canManage && !self && options.length > 0 ? (
                        <select
                          className="input"
                          aria-label={`Role for ${m.email ?? m.user_id}`}
                          value={m.role}
                          onChange={(e) => changeRole(m, e.target.value as Role)}
                        >
                          {options.map((r) => (
                            <option key={r} value={r}>
                              {r[0].toUpperCase() + r.slice(1)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="tag tag-neutral">{m.role}</span>
                      )}
                      {(self || (canManage && (m.role !== 'owner' || myRole === 'owner'))) && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-danger"
                          onClick={() => remove(m)}
                          aria-label={self ? 'Leave workspace' : `Remove ${m.email ?? 'member'}`}
                        >
                          {self ? 'Leave' : <Icon name="x" />}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {!canManage && error && (
              <div className="error-text" role="alert">
                {error}
              </div>
            )}
          </section>
        </div>

        <aside className="card members-roles" aria-labelledby="roles-h">
          <h2 id="roles-h">Roles</h2>
          <dl>
            {(['owner', 'admin', 'editor', 'viewer'] as Role[]).map((r) => (
              <div key={r}>
                <dt>{r[0].toUpperCase() + r.slice(1)}</dt>
                <dd>{ROLE_HELP[r]}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </SubPage>
  );
}
