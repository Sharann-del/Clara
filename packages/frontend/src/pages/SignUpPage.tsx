import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as cognito from '../lib/cognito';
import { useAuth } from '../context/AuthContext';

type Stage = 'signup' | 'verify';

export function SignUpPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSignUp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await cognito.signUp(email, password);
      setStage('verify');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await cognito.confirmSignUp(email, code);
      await signIn(email, password);
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'verify') {
    return (
      <div className="auth-shell">
        <form className="auth-card" onSubmit={onVerify}>
          <h1>Verify your email</h1>
          <p className="muted">We sent a verification code to {email}.</p>
          <input
            className="input"
            placeholder="Verification code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify & sign in'}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => cognito.resendConfirmationCode(email)}
          >
            Resend code
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={onSignUp}>
        <h1>Create your Clara account</h1>
        <input
          className="input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="input"
          type="password"
          placeholder="Password (10+ chars, upper/lower/digit)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <div className="error-text">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Sign up'}
        </button>
        <div className="muted">
          Already have an account? <Link to="/signin">Sign in</Link>
        </div>
      </form>
    </div>
  );
}
