import { useCallback, useEffect, useState } from 'react';
import { api, type Workspace } from './api';

// One shared list for the sidebar switcher, the palette and the home page; refreshed on demand.
let cache: Workspace[] | null = null;
let inflight: Promise<Workspace[]> | null = null;
const listeners = new Set<(w: Workspace[]) => void>();

export function refreshWorkspaces(): Promise<Workspace[]> {
  inflight ??= api
    .listWorkspaces()
    .then((w) => {
      cache = w;
      listeners.forEach((l) => l(w));
      return w;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useWorkspaces(): {
  workspaces: Workspace[] | null;
  error: string | null;
  refresh: () => Promise<Workspace[]>;
} {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(cache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listeners.add(setWorkspaces);
    if (!cache) refreshWorkspaces().catch((e) => setError(e.message));
    return () => {
      listeners.delete(setWorkspaces);
    };
  }, []);
  const refresh = useCallback(() => refreshWorkspaces(), []);
  return { workspaces, error, refresh };
}

/** Clear on sign-out so the next user never sees the previous user's list. */
export function clearWorkspaceCache() {
  cache = null;
}
