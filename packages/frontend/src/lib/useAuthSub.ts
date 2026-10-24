import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';

/** The signed-in user's Cognito `sub`, read from the ID token's payload (already verified server-side). */
export function useAuthSub(): string | null {
  const { idToken } = useAuth();
  return useMemo(() => {
    if (!idToken) return null;
    try {
      const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }, [idToken]);
}
