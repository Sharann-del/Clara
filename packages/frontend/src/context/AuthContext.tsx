import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as cognito from '../lib/cognito';

interface AuthState {
  loading: boolean;
  idToken: string | null;
  email: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const session = await cognito.getCurrentSession();
    if (session?.isValid()) {
      setIdToken(session.getIdToken().getJwtToken());
      // The pool's username is the Cognito sub, not the email; the ID token carries the email claim.
      const claim = session.getIdToken().decodePayload().email;
      setEmail(typeof claim === 'string' ? claim : cognito.getCurrentUserEmail());
    } else {
      setIdToken(null);
      setEmail(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const signIn = useCallback(
    async (emailArg: string, password: string) => {
      await cognito.signIn(emailArg, password);
      await refresh();
    },
    [refresh],
  );

  const signOutFn = useCallback(() => {
    cognito.signOut();
    setIdToken(null);
    setEmail(null);
  }, []);

  const value = useMemo(
    () => ({ loading, idToken, email, signIn, signOut: signOutFn, refresh }),
    [loading, idToken, email, signIn, signOutFn, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
