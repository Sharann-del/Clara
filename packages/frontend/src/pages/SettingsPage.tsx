import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { Icon } from '../components/ui/Icon';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../context/AuthContext';
import { changePassword } from '../lib/cognito';
import { usePageMeta } from '../lib/seo';
import { friendlyAuthError } from './SignInPage';

export function SettingsNav({ current }: { current: 'profile' | 'tokens' }) {
  return (
    <nav className="settings-nav" aria-label="Settings">
      <Link
        to="/settings"
        aria-current={current === 'profile' ? 'page' : undefined}
        className={current === 'profile' ? 'active' : ''}
      >
        <Icon name="settings" /> Profile
      </Link>
      <Link
        to="/settings/tokens"
        aria-current={current === 'tokens' ? 'page' : undefined}
        className={current === 'tokens' ? 'active' : ''}
      >
        <Icon name="key" /> Access tokens
      </Link>
    </nav>
  );
}

export function SettingsPage() {
  usePageMeta('Settings', { noindex: true });
  const { email, signOut } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      toast.success('Password changed');
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title={<strong>Settings</strong>}>
      <div className="settings">
        <SettingsNav current="profile" />
        <div className="settings-body">
          <section className="panel settings-card" aria-labelledby="profile-h">
            <h2 id="profile-h" className="panel-title">
              Profile
            </h2>
            <div className="settings-row">
              <span className="ws-avatar user" style={{ width: 40, height: 40, fontSize: 16 }} aria-hidden="true">
                {(email ?? '?').slice(0, 1).toUpperCase()}
              </span>
              <div>
                <div style={{ fontWeight: 600 }}>{email}</div>
                <div className="muted">This is how teammates see you and find you when they share.</div>
              </div>
            </div>
          </section>

          <section className="panel settings-card" aria-labelledby="pw-h">
            <h2 id="pw-h" className="panel-title">
              Password
            </h2>
            <form onSubmit={onChangePassword} className="settings-form">
              <label className="field">
                Current password
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                New password
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  required
                />
                <span className="field-hint">At least 10 characters, with uppercase, lowercase and a number.</span>
              </label>
              {error && (
                <div className="error-text" role="alert">
                  {error}
                </div>
              )}
              <div>
                <button className="btn btn-primary" type="submit" disabled={busy}>
                  {busy ? 'Changing…' : 'Change password'}
                </button>
              </div>
            </form>
          </section>

          <section className="panel settings-card" aria-labelledby="ai-h">
            <h2 id="ai-h" className="panel-title">
              AI assistants
            </h2>
            <p className="muted" style={{ margin: '0 0 10px', fontSize: 14 }}>
              Connect Claude over MCP with a personal access token. Its edits wait for your review.
            </p>
            <Link to="/settings/tokens" className="btn">
              <Icon name="key" /> Manage access tokens
            </Link>
          </section>

          <section className="panel settings-card" aria-labelledby="session-h">
            <h2 id="session-h" className="panel-title">
              Session
            </h2>
            <button type="button" className="btn" onClick={signOut}>
              <Icon name="logout" /> Sign out on this device
            </button>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
