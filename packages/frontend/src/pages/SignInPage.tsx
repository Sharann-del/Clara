import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePageMeta } from '../lib/seo';
import { safeNext } from '../lib/nextPath';
import { AuthLayout } from './AuthLayout';

/** Cognito's messages are written for developers; map the common ones to plain language. */
export function friendlyAuthError(err: unknown): string {
  const e = err as { code?: string; name?: string; message?: string };
  switch (e.code ?? e.name) {
    case 'NotAuthorizedException':
      return 'That email and password don’t match. Check them and try again.';
    case 'UserNotFoundException':
      return 'There’s no account with that email. Create one instead?';
    case 'UserNotConfirmedException':
      return 'This account isn’t verified yet. Finish signing up with the code we emailed you.';
    case 'UsernameExistsException':
      return 'An account with this email already exists. Sign in instead.';
    case 'InvalidPasswordException':
      return 'Use at least 10 characters, with an uppercase letter, a lowercase letter and a number.';
    case 'CodeMismatchException':
      return 'That code isn’t right. Check the email and try again.';
    case 'ExpiredCodeException':
      return 'That code has expired. Send a new one.';
    case 'UserLambdaValidationException':
      // The pre-sign-up trigger's own message, e.g. "That invite code isn't valid."
      return (e.message ?? '').replace(/^PreSignUp failed with error\s*/, '') || 'Sign-ups are restricted on this deployment.';
    case 'LimitExceededException':
    case 'TooManyRequestsException':
      return 'Too many attempts. Wait a minute, then try again.';
    default:
      return e.message ?? 'Something went wrong. Try again.';
  }
}

export function SignInPage() {
  usePageMeta('Sign in', { noindex: true });
  const { signIn, idToken, loading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const reason = params.get('reason');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && idToken && !busy) return <Navigate to={next} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(friendlyAuthError(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1>Sign in to Clara</h1>
      {reason === 'save' && <p className="muted" style={{ margin: 0 }}>Sign in to save your playground diagram to a workspace.</p>}
      <form onSubmit={onSubmit} style={{ display: 'contents' }} noValidate={false}>
        <label className="field">
          Email
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          Password
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <div className="error-text" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div className="muted">
        New to Clara? <Link to={`/signup${params.toString() ? `?${params}` : ''}`}>Create an account</Link>
      </div>
    </AuthLayout>
  );
}
