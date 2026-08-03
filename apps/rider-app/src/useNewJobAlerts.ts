import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { formatRupees } from './theme';
import { startAlert, stopAlert } from './sound';
import { canNotify, notifyNewJob, requestNotifyPermission, vibrate } from './notify';
import { onSocket } from './socket';
import type { RiderJob } from './types';

/** Fallback poll cadence — only a safety net now that jobs arrive via socket (ms). */
const POLL_MS = 60000;
/** Re-pulse the vibration on this cadence while an alert is unacknowledged (ms). */
const VIBRATE_MS = 3000;

export interface NewJobAlerts {
  /** The fresh job currently ringing, or null when acknowledged. */
  alertJob: RiderJob | null;
  /** True if the sound couldn't start (no user gesture yet) — show a hint. */
  alertSilent: boolean;
  /** Stop the sound + clear the banner. */
  acknowledge: () => void;
  /** Whether browser notifications are granted (so the app can hide the prompt). */
  notifyGranted: boolean;
  /** Ask for notification permission (from a user gesture). */
  requestPermission: () => Promise<void>;
}

/**
 * App-wide new-job alerts for the rider. Lifted to the app root so it fires on
 * ANY tab (Home / Jobs / Deliveries): while `enabled` (signed in AND online) it
 * polls the job board on an interval, and on a genuinely new available job rings
 * the looping sound + vibrates + shows a banner + fires a backgrounded-tab OS
 * notification. The first poll only seeds the baseline so existing jobs don't
 * alarm. Web-first; all browser APIs are guarded so native is a graceful no-op.
 */
export function useNewJobAlerts(enabled: boolean): NewJobAlerts {
  const [alertJob, setAlertJob] = useState<RiderJob | null>(null);
  const [alertSilent, setAlertSilent] = useState(false);
  const [notifyGranted, setNotifyGranted] = useState<boolean>(() => canNotify());
  // Baseline of known job ids; null until the first poll seeds it.
  const knownRef = useRef<Set<string> | null>(null);

  const requestPermission = useCallback(async () => {
    const result = await requestNotifyPermission();
    setNotifyGranted(result === 'granted');
  }, []);

  const acknowledge = useCallback(() => {
    stopAlert();
    setAlertJob(null);
    setAlertSilent(false);
  }, []);

  /**
   * Compare freshly-fetched jobs against the previous set; on a new one fire the
   * alert. First call only seeds the baseline (no alarm on existing jobs).
   */
  const detect = useCallback((jobs: RiderJob[]) => {
    const ids = new Set(jobs.map((j) => j.id));
    const prev = knownRef.current;
    knownRef.current = ids;
    if (prev === null) return; // first load — seed only
    const fresh = jobs.find((j) => !prev.has(j.id));
    if (fresh) {
      setAlertJob(fresh);
      setAlertSilent(!startAlert());
      vibrate();
      notifyNewJob(
        'New delivery job!',
        `${fresh.shop?.name ?? 'Pickup'} · ${formatRupees(fresh.deliveryFeePaise)} fee`,
      );
    }
  }, []);

  // Poll the job board on an interval while enabled, regardless of active tab.
  // When disabled (offline / logged out) reset the baseline so going back online
  // re-seeds instead of alarming on the whole existing board.
  useEffect(() => {
    if (!enabled) {
      knownRef.current = null;
      stopAlert();
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const jobs = (await api.riderJobs()) as RiderJob[];
        if (alive) detect(jobs);
      } catch {
        /* transient — the next tick retries */
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    // Realtime: a job.offered push triggers an immediate refresh (no waiting for
    // the 60s fallback poll). Socket is the primary path; poll is the safety net.
    const off = onSocket('job.offered', () => { void load(); });
    return () => {
      alive = false;
      clearInterval(id);
      off();
    };
  }, [enabled, detect]);

  // Re-pulse the vibration while an alert is unacknowledged so it keeps being
  // felt (the sound loops on its own inside sound.ts).
  useEffect(() => {
    if (!alertJob) return;
    const id = setInterval(() => vibrate(), VIBRATE_MS);
    return () => clearInterval(id);
  }, [alertJob]);

  // Safety: stop any looping sound if the hook unmounts.
  useEffect(() => () => stopAlert(), []);

  return { alertJob, alertSilent, acknowledge, notifyGranted, requestPermission };
}
