import { getCurrentSession } from './cognito';

const WS_URL = import.meta.env.VITE_WS_URL;

export type RealtimeHandler = (msg: Record<string, unknown>) => void;

export interface RealtimeConnection {
  send: (action: string, payload?: Record<string, unknown>) => void;
  close: () => void;
}

/**
 * Opens one WebSocket for a given document/diagram, matching the room the
 * connect Lambda derives server-side. Auto-reconnects on unexpected close
 * (not on a deliberate `close()` call) since a dropped connection otherwise
 * silently stops delivering live updates.
 */
export function connectRealtime(
  resourceType: 'document' | 'diagram',
  resourceId: string,
  onMessage: RealtimeHandler,
): RealtimeConnection {
  let ws: WebSocket | null = null;
  let closedByCaller = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  async function open() {
    const session = await getCurrentSession();
    const token = session?.isValid() ? session.getIdToken().getJwtToken() : '';
    const url = `${WS_URL}?token=${encodeURIComponent(token)}&resourceType=${resourceType}&resourceId=${resourceId}`;
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      ws?.send(JSON.stringify({ action: 'presence.sync' }));
    });

    ws.addEventListener('message', (ev) => {
      try {
        onMessage(JSON.parse(ev.data as string));
      } catch {
        // ignore malformed frames
      }
    });

    ws.addEventListener('close', () => {
      if (closedByCaller) return;
      reconnectTimer = setTimeout(open, 2000);
    });
  }

  open();

  return {
    send(action, payload = {}) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action, ...payload }));
      }
    },
    close() {
      closedByCaller = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
