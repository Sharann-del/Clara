export interface PresenceUser {
  userId: string;
  email?: string;
}

const COLORS = ['#db2777', '#0f7a56', '#7c3aed', '#c2410c', '#0e7490', '#4d7c0f', '#be123c', '#1d4ed8'];
export const colorFor = (id: string) => COLORS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];

/** Avatars of other people viewing the same document or diagram. */
export function Presence({ users }: { users: PresenceUser[] }) {
  if (users.length === 0) return null;
  const shown = users.slice(0, 4);
  const label = `Also here: ${users.map((u) => u.email ?? 'someone').join(', ')}`;
  return (
    <div className="presence" role="img" aria-label={label} title={label}>
      {shown.map((u) => (
        <span key={u.userId} className="avatar" style={{ background: colorFor(u.userId) }}>
          {(u.email ?? u.userId).slice(0, 2).toUpperCase()}
        </span>
      ))}
      {users.length > shown.length && <span className="avatar" style={{ background: '#5f6b80' }}>+{users.length - shown.length}</span>}
    </div>
  );
}
