import { createContext, useContext, useEffect, useState } from 'react';

export const LiveRevision = createContext(0);
export const useLiveRevision = () => useContext(LiveRevision);

/** One socket per role page. All personalized reads remain on the existing HTTP APIs. */
export function usePartyRealtime(
  role: 'guest' | 'admin' | 'display',
  token: string,
) {
  const [revision, setRevision] = useState(0);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (typeof WebSocket === 'undefined') return;
    let stopped = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let batch: ReturnType<typeof setTimeout> | undefined;
    let readyTimeout: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const refresh = () => {
      if (batch || stopped) return;
      batch = setTimeout(() => {
        batch = undefined;
        if (!stopped) setRevision((value) => value + 1);
      }, 80);
    };
    const reconnect = () => {
      if (stopped || retry) return;
      const delay =
        Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)) +
        Math.random() * 500;
      retry = setTimeout(() => {
        retry = undefined;
        connect();
      }, delay);
    };
    const connect = () => {
      if (stopped) return;
      try {
        const url = new URL(
          `/api/party-links/${role}/${encodeURIComponent(token)}/live`,
          window.location.origin,
        );
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        const active = new WebSocket(url);
        socket = active;
        readyTimeout = setTimeout(() => active.close(), 10000);
        active.onmessage = (event) => {
          if (
            stopped ||
            socket !== active ||
            typeof event.data !== 'string' ||
            event.data.length > 128
          )
            return;
          try {
            const message = JSON.parse(event.data) as { type?: unknown };
            if (message?.type === 'ready') {
              clearTimeout(readyTimeout);
              failures = 0;
              setConnected(true);
              refresh(); // Recover anything missed while disconnected, including initial-load races.
            } else if (message?.type === 'changed') refresh();
          } catch {
            /* Invalid messages never become application data. */
          }
        };
        active.onclose = () => {
          if (stopped || socket !== active) return;
          clearTimeout(readyTimeout);
          socket = undefined;
          setConnected(false);
          reconnect();
        };
        active.onerror = () => active.close();
      } catch {
        reconnect();
      }
    };
    const resume = () => {
      if (document.visibilityState === 'hidden') return;
      refresh();
      if (!socket || socket.readyState > 1) {
        clearTimeout(retry);
        retry = undefined;
        connect();
      }
    };
    connect();
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(batch);
      clearTimeout(readyTimeout);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
      socket?.close();
    };
  }, [role, token]);
  return { revision, connected };
}
