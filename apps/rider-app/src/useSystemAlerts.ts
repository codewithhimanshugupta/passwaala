import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { notifyAlert, vibrate } from './notify';
import { onSocket } from './socket';

/** Fallback poll cadence — alerts arrive via socket; this is a safety net (ms). */
const POLL_MS = 60000;

export interface RiderAlert {
  id: string;
  message: string;
  isWarning: boolean;
  createdAt: string;
}

export interface SystemAlerts {
  /** The most recent system alerts (newest first). */
  alerts: RiderAlert[];
  /** Count of alerts the rider hasn't seen yet (drives the tab badge). */
  unread: number;
  /** Mark everything currently loaded as seen (call when the Alerts tab opens). */
  markSeen: () => void;
}

/**
 * App-wide system alerts for the rider (escalations, penalties, stale-order
 * releases). Lifted to the app root so it polls on EVERY tab while signed in.
 * On a genuinely new alert it vibrates + fires an OS/browser notification (no
 * looping sound — these are less urgent than a fresh job) and bumps the unread
 * count so the Alerts tab shows a badge. The first poll only seeds the baseline
 * so existing alerts don't re-notify on launch. Web-first; all browser APIs are
 * guarded so native degrades gracefully.
 */
export function useSystemAlerts(enabled: boolean): SystemAlerts {
  const [alerts, setAlerts] = useState<RiderAlert[]>([]);
  const [unread, setUnread] = useState(0);
  // Baseline of known alert ids; null until the first poll seeds it.
  const knownRef = useRef<Set<string> | null>(null);

  const markSeen = useCallback(() => setUnread(0), []);

  const detect = useCallback((incoming: RiderAlert[]) => {
    setAlerts(incoming);
    const ids = new Set(incoming.map((a) => a.id));
    const prev = knownRef.current;
    knownRef.current = ids;
    if (prev === null) return; // first load — seed only, don't alarm
    const fresh = incoming.filter((a) => !prev.has(a.id));
    if (fresh.length > 0) {
      setUnread((n) => n + fresh.length);
      vibrate();
      const first = fresh[0];
      notifyAlert(
        first.isWarning ? 'PassWaala Alert' : 'PassWaala Update',
        fresh.length > 1 ? `${fresh.length} new alerts` : first.message,
      );
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      knownRef.current = null;
      setAlerts([]);
      setUnread(0);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const rows = await api.riderNotifications();
        if (alive) detect(rows.slice(0, 20).map((r) => ({
          id: r.id, message: r.message, isWarning: r.isWarning, createdAt: r.createdAt,
        })));
      } catch {
        /* transient — the next tick retries */
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    const off = onSocket('system.alert', () => { void load(); });
    return () => {
      alive = false;
      clearInterval(id);
      off();
    };
  }, [enabled, detect]);

  return { alerts, unread, markSeen };
}
