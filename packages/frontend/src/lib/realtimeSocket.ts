import { getCurrentSession } from './cognito';
import { backoffDelay } from './backoff';

const WS_URL = import.meta.env.VITE_WS_URL;

export type RealtimeHandler = (msg: Record<string, unknown>) => void;
export type RealtimeStatus = 'connecting' | 'open' | 'reconnecting' | 'offline';

export interface RealtimeOptions {
  /** Connection state changes, for a "Reconnecting…" indicator. */
  onStatus?: (status: RealtimeStatus) => void;
  /**
   * Fired when a connection opens after an earlier one dropped. Messages broadcast while
   * disconnected are lost, so callers should refetch the resource here.
   */
  onReconnect?: () => void;
}

export interface RealtimeConnection {
  send: (action: string, payload?: Record<string, unknown>) => void;
  close: () => void;
}

/**
 * API Gateway drops a WebSocket after 10 minutes without traffic, so an idle tab pings
 * well inside that. (The connection is also capped at 2 hours; the backoff loop below
 * handles that like any other drop.)
 */
export const PING_INTERVAL_MS = 4 * 60 * 1000;
/** A connection that stays up this long resets the backoff. */
const STABLE_AFTER_MS = 10_000;

/**
 * Opens one WebSocket for a given document/diagram, matching the room the connect Lambda
 * derives server-side. Keeps it alive with periodic pings, and on an unexpected close
 * reconnects with exponential backoff (immediately when the browser comes back online or
 * the tab becomes visible). A fresh ID token is fetched for every attempt, so an expired
 * token is refreshed rather than retried. `close()` stops everything.
 */
export function connectRealtime(
  resourceType: 'document' | 'diagram',
  resourceId: string,
  onMessage: RealtimeHandler,
  options: RealtimeOptions = {},
): RealtimeConnection {
  let ws: WebSocket | null = null;
  let closedByCaller = false;
  let attempt = 0;
  let everOpened = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;

  const setStatus = (s: RealtimeStatus) => options.onStatus?.(s);

  function clearTimers() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    if (stableTimer) clearTimeout(stableTimer);
    reconnectTimer = pingTimer = stableTimer = undefined;
  }

  function scheduleReconnect() {
    if (closedByCaller || reconnectTimer) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus('offline'); // the 'online' listener reconnects
      return;
    }
    setStatus('reconnecting');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      open();
    }, backoffDelay(attempt));
    attempt += 1;
  }

  async function open() {
    if (closedByCaller) return;
    setStatus(everOpened ? 'reconnecting' : 'connecting');
    let token = '';
    try {
      const session = await getCurrentSession();
      token = session?.isValid() ? session.getIdToken().getJwtToken() : '';
    } catch {
      // fall through: an empty token gets a 401 on $connect, which schedules a retry
    }
    if (closedByCaller) return;

    const url = `${WS_URL}?token=${encodeURIComponent(token)}&resourceType=${resourceType}&resourceId=${resourceId}`;
    const socket = new WebSocket(url);
    ws = socket;

    socket.addEventListener('open', () => {
      if (ws !== socket) return;
      socket.send(JSON.stringify({ action: 'presence.sync' }));
      setStatus('open');
      pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: 'ping' }));
      }, PING_INTERVAL_MS);
      stableTimer = setTimeout(() => {
        attempt = 0;
      }, STABLE_AFTER_MS);
      if (everOpened) options.onReconnect?.();
      everOpened = true;
    });

    socket.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg?.type === 'pong') return;
        onMessage(msg);
      } catch {
        // ignore malformed frames
      }
    });

    socket.addEventListener('close', () => {
      if (ws !== socket) return;
      clearTimers();
      ws = null;
      scheduleReconnect();
    });
  }

  /** Skip the remaining backoff when there's a good reason to think it would work now. */
  function reconnectNow() {
    if (closedByCaller || (ws && ws.readyState <= WebSocket.OPEN)) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    open();
  }
  const onOnline = () => reconnectNow();
  const onOffline = () => setStatus('offline');
  const onVisible = () => {
    if (document.visibilityState === 'visible') reconnectNow();
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisible);

  open();

  return {
    send(action, payload = {}) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action, ...payload }));
      }
    },
    close() {
      closedByCaller = true;
      clearTimers();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      ws?.close();
      ws = null;
    },
  };
}
