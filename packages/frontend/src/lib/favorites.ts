import { useCallback, useEffect, useState } from 'react';
import { api, isMissingRoute } from './api';

export interface Favorite {
  kind: 'document' | 'diagram';
  id: string;
  name: string;
}

const LOCAL_KEY = 'clara.favorites';
let cache: Favorite[] | null = null;
/** Set once the API turns out not to have /favorites yet: favorites then live in this browser only. */
let localOnly = false;
const listeners = new Set<(f: Favorite[]) => void>();

function readLocal(): Favorite[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as Favorite[];
  } catch {
    return [];
  }
}
function writeLocal(f: Favorite[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(f));
  } catch {
    // ignore
  }
}
function publish(f: Favorite[]) {
  cache = f;
  listeners.forEach((l) => l(f));
}

async function load(): Promise<Favorite[]> {
  if (localOnly) return readLocal();
  try {
    return await api.listFavorites();
  } catch (err) {
    if (!isMissingRoute(err)) throw err;
    localOnly = true;
    return readLocal();
  }
}

/** Starred documents and diagrams, shared by the home page, item menus and editor top bars. */
export function useFavorites() {
  const [favorites, setFavorites] = useState<Favorite[]>(cache ?? []);
  useEffect(() => {
    listeners.add(setFavorites);
    if (!cache) load().then(publish).catch(() => publish([]));
    return () => {
      listeners.delete(setFavorites);
    };
  }, []);

  const isFavorite = useCallback((kind: string, id: string) => favorites.some((f) => f.kind === kind && f.id === id), [favorites]);

  const toggle = useCallback(async (f: Favorite) => {
    const current = cache ?? [];
    const on = current.some((x) => x.kind === f.kind && x.id === f.id);
    const next = on ? current.filter((x) => !(x.kind === f.kind && x.id === f.id)) : [f, ...current];
    publish(next);
    if (localOnly) {
      writeLocal(next);
      return;
    }
    try {
      if (on) await api.removeFavorite(f.kind, f.id);
      else await api.addFavorite(f.kind, f.id);
    } catch (err) {
      if (isMissingRoute(err)) {
        localOnly = true;
        writeLocal(next);
        return;
      }
      publish(current); // roll back
      throw err;
    }
  }, []);

  return { favorites, isFavorite, toggle };
}
