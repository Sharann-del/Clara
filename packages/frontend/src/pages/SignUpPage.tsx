import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import * as cognito from '../lib/cognito';
import { useAuth } from '../context/AuthContext';
import { usePageMeta } from '../lib/seo';
import { safeNext } from '../lib/nextPath';
import { AuthLayout } from './AuthLayout';
import { friendlyAuthError } from './SignInPage';
import { useToast } from '../components/ui/Toast';

type Stage = 'signup' | 'verify';

export function SignUpPage() {
  usePageMeta('Create your account', { noindex: true });
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [stage, setStage] = useState<Stage>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSignUp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await cognito.signUp(email.trim(), password, cognito.inviteCodeRequired ? inviteCode.trim() : undefined);
      setStage('verify');
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await cognito.confirmSignUp(email.trim(), code.trim());
      await signIn(email.trim(), password);
      // `welcome=1` lets the app home run first-time setup (first workspace, sample content, tour).
      navigate(next === '/app' ? '/app?welcome=1' : next, { replace: true });
    } catch (err) {
      setError(friendlyAuthError(err));
      setBusy(false);
    }
  }

  async function resend() {
    try {
      await cognito.resendConfirmationCode(email.trim());
      toast.success(`Sent a new code to ${email.trim()}`);
    } catch (err) {
      setError(friendlyAuthError(err));
    }
  }

  if (stage === 'verify') {
    return (
      <AuthLayout>
        <h1>Check your email</h1>
        <p className="muted" style={{ margin: 0 }}>
          We sent a 6-digit code to <strong>{email}</strong>. Enter it to finish creating your account.
        </p>
        <form onSubmit={onVerify} style={{ display: 'contents' }}>
          <label className="field">
            Verification code
            <input
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
            />
          </label>
          {error && (
            <div className="error-text" role="alert">
              {error}
            </div>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify and continue'}
          </button>
        </form>
        <button className="btn btn-ghost" type="button" onClick={resend}>
          Send a new code
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1>Create your Clara account</h1>
      <p className="muted" style={{ margin: 0 }}>
        Free during early access. We'll set up a workspace with a sample doc and diagram.
      </p>
      <form onSubmit={onSignUp} style={{ display: 'contents' }}>
        <label className="field">
          Email
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label className="field">
          Password
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            minLength={10}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="pw-hint"
            required
          />
          <span id="pw-hint" className="field-hint">
            At least 10 characters, with uppercase, lowercase and a number.
          </span>
        </label>
        {cognito.inviteCodeRequired && (
          <label className="field">
            Invite code
            <input
              className="input"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              required
            />
          </label>
        )}
        {error && (
          <div className="error-text" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <div className="muted">
        Already have an account? <Link to={`/signin${params.toString() ? `?${params}` : ''}`}>Sign in</Link>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        By creating an account you agree to the <Link to="/terms">terms</Link> and{' '}
        <Link to="/privacy">privacy policy</Link>.
      </div>
    </AuthLayout>
  );
}
