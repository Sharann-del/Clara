import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PersonalAccessToken } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const EXPIRY: { label: string; days: number | null }[] = [
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
  { label: 'Never', days: null },
];

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

function status(t: PersonalAccessToken) {
  if (t.revoked_at) return 'revoked';
  if (t.expires_at && new Date(t.expires_at) < new Date()) return 'expired';
  return 'active';
}

export function TokensPage() {
  const { email, signOut } = useAuth();
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([]);
  const [name, setName] = useState('');
  const [days, setDays] = useState<number | null>(90);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.listTokens().then(setTokens).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const t = await api.createToken(name.trim(), days);
      setFresh(t.token);
      setCopied(false);
      setName('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(t: PersonalAccessToken) {
    if (!window.confirm(`Revoke "${t.name}"? Anything using it will stop working immediately.`)) return;
    await api.revokeToken(t.id).catch((e) => setError(e.message));
    await load();
  }

  const command = `claude mcp add --transport http clara ${api.mcpUrl} --header "Authorization: Bearer ${fresh ?? '<your token>'}"`;

  return (
    <div className="app-shell">
      <div className="main-area">
        <div className="topbar">
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <strong>← Clara</strong>
          </Link>
          <div className="muted">
            {email} · <button className="btn" onClick={signOut}>Sign out</button>
          </div>
        </div>
        <div className="content" style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
          <h2>Access tokens for AI assistants</h2>
          <p className="muted">
            A token lets an MCP client such as Claude act as you in Clara, with exactly your workspace roles. It can read
            what you can read, but its writes are only proposals: you accept or reject each one under a workspace's
            “Pending changes”.
          </p>

          {fresh && (
            <div className="panel" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
              <strong>Copy your new token now — it won't be shown again.</strong>
              <pre className="diff-text" style={{ userSelect: 'all', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{fresh}</pre>
              <button
                className="btn"
                onClick={() => navigator.clipboard.writeText(fresh).then(() => setCopied(true)).catch(() => undefined)}
              >
                {copied ? 'Copied' : 'Copy token'}
              </button>{' '}
              <button className="btn" onClick={() => setFresh(null)}>Done</button>
            </div>
          )}

          <div className="panel" style={{ marginBottom: 16 }}>
            <strong>New token</strong>
            <div className="editor-toolbar" style={{ marginTop: 8 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="Name, e.g. “Claude Code on my laptop”"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
              />
              <select className="input" value={String(days)} onChange={(e) => setDays(e.target.value === 'null' ? null : Number(e.target.value))}>
                {EXPIRY.map((o) => (
                  <option key={o.label} value={String(o.days)}>Expires: {o.label}</option>
                ))}
              </select>
              <button className="btn btn-primary" onClick={create} disabled={busy || !name.trim()}>
                Create
              </button>
            </div>
            {error && <div className="error-text">{error}</div>}
          </div>

          <h3>Your tokens</h3>
          {tokens.length === 0 && <p className="muted">No tokens yet.</p>}
          {tokens.map((t) => (
            <div className="list-item" key={t.id} style={{ opacity: status(t) === 'active' ? 1 : 0.55 }}>
              <span>
                <strong>{t.name}</strong> <code>{t.token_prefix}…</code>
                <div className="muted" style={{ fontSize: 12 }}>
                  created {fmt(t.created_at)} · expires {fmt(t.expires_at)} · last used {fmt(t.last_used_at)} · {status(t)}
                </div>
              </span>
              {status(t) === 'active' && (
                <button className="btn btn-danger" onClick={() => revoke(t)}>Revoke</button>
              )}
            </div>
          ))}

          <h3>Connect Claude Code</h3>
          <pre className="diff-text" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{command}</pre>
          <p className="muted">
            Server URL: <code>{api.mcpUrl}</code> · header <code>Authorization: Bearer &lt;token&gt;</code>
          </p>
        </div>
      </div>
    </div>
  );
}
