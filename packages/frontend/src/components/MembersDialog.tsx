import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog } from './ui/Dialog';
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
  onClose: () => void;
  workspaceId: string;
  myRole?: Role;
  mySub?: string;
}

export function MembersDialog({ open, onClose, workspaceId, myRole, mySub }: Props) {
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

  return (
    <Dialog open={open} onClose={onClose} title="Members" description="People in this workspace and what they can do." size="md">
      {members === null ? (
        <SkeletonRows rows={3} />
      ) : (
        <ul className="member-list" role="list">
          {members.map((m) => {
            const self = m.user_id === mySub;
            const options = assignable(m);
            return (
              <li key={m.user_id} className="member-row">
                <span className="ws-avatar user" aria-hidden="true">
                  {(m.email ?? '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="member-email">
                  {m.email ?? m.user_id}
                  {self && <span className="muted"> (you)</span>}
                </span>
                {canManage && !self && options.length > 0 ? (
                  <select
                    className="input"
                    aria-label={`Role for ${m.email ?? m.user_id}`}
                    value={m.role}
                    onChange={(e) => changeRole(m, e.target.value as Role)}
                    title={ROLE_HELP[m.role]}
                  >
                    {options.map((r) => (
                      <option key={r} value={r}>
                        {r[0].toUpperCase() + r.slice(1)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="tag tag-neutral" title={ROLE_HELP[m.role]}>
                    {m.role}
                  </span>
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
      {canManage && (
        <form onSubmit={invite} className="invite-row">
          <label className="field" style={{ flex: 1 }}>
            Invite by email
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
            Role
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ alignSelf: 'flex-end' }}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </form>
      )}
      <p className="field-hint" style={{ margin: 0 }}>
        People need a Clara account first. {ROLE_HELP[role] && canManage ? `${role[0].toUpperCase() + role.slice(1)}s: ${ROLE_HELP[role].toLowerCase()}.` : ''}
      </p>
      {error && (
        <div className="error-text" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}
