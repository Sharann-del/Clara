import { useCallback, useEffect, useState } from 'react';
import { api, type Member } from '../lib/api';

export function MembersPanel({ workspaceId, canInvite }: { workspaceId: string; canInvite: boolean }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    () => api.listMembers(workspaceId).then(setMembers).catch((e) => setError(e.message)),
    [workspaceId],
  );
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function invite() {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.inviteMember(workspaceId, email.trim(), role);
      setEmail('');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <strong>Members</strong>
      {members.map((m) => (
        <div className="list-item" key={m.user_id}>
          <span>{m.email ?? m.user_id}</span>
          <span className="tag">{m.role}</span>
        </div>
      ))}
      {canInvite && (
        <div className="editor-toolbar" style={{ marginTop: 8 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            type="email"
            placeholder="Email of an existing Clara user"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && invite()}
          />
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button className="btn btn-primary" onClick={invite} disabled={busy}>
            Invite
          </button>
        </div>
      )}
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
