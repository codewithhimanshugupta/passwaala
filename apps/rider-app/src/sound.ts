/**
 * Web-only looping alert sound for new delivery jobs. Uses the Web Audio API to
 * synthesize a loud, repeating "tring tring" bell ring (no asset file) — two
 * bright bell strikes per loop, like a classic telephone. A module-level
 * singleton keeps it from double-playing if triggered again while already
 * looping. Native is a graceful no-op (foreground-service audio is out of scope).
 */

/** Minimal structural type so we don't depend on DOM lib type declarations. */
interface MinimalAudioContext {
  currentTime: number;
  destination: unknown;
  state: string;
  resume?: () => Promise<void>;
  close?: () => Promise<void>;
  createOscillator: () => {
    type: string;
    frequency: { value: number };
    connect: (n: unknown) => unknown;
    start: (t: number) => void;
    stop: (t: number) => void;
  };
  createGain: () => {
    gain: {
      value: number;
      setValueAtTime: (v: number, t: number) => void;
      exponentialRampToValueAtTime: (v: number, t: number) => void;
    };
    connect: (n: unknown) => unknown;
  };
}

type AudioContextCtor = new () => MinimalAudioContext;

let ctx: MinimalAudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function getCtor(): AudioContextCtor | null {
  const g = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/**
 * One bright bell strike at `at` seconds (context time). A mechanical telephone
 * bell gets its shimmer from TWO gongs tuned slightly apart — the small
 * frequency gap "beats" into a warble that cuts through noise. We reproduce
 * that with two detuned high fundamentals (~1480/1560Hz) plus sharp inharmonic
 * partials, each a fast-attack / exponential-decay ping. Loud (peak gain ~0.9).
 */
function bellStrike(at: number): void {
  const c = ctx;
  if (!c) return;
  // Two detuned fundamentals (the warble) + bright inharmonic partials that
  // slice through background noise, with relative gains.
  const partials: Array<[number, number]> = [
    [1480, 0.9],
    [1560, 0.85], // ~80Hz beat against 1480 → mechanical warble
    [2350, 0.4],
    [3100, 0.22],
  ];
  for (const [freq, level] of partials) {
    try {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'triangle'; // brighter than sine, cuts through noise
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(c.destination);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(level, at + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
      osc.start(at);
      osc.stop(at + 0.45);
    } catch {
      /* ignore a single failed partial */
    }
  }
}

/**
 * "Tring tring" — two quick bell strikes, like a classic telephone ring.
 * The interval loop calls this once per cycle.
 */
function beep(): void {
  const c = ctx;
  if (!c) return;
  const now = c.currentTime;
  bellStrike(now);
  bellStrike(now + 0.28); // second "tring" of the pair
}

/**
 * Unlock audio for later autoplay. Browser autoplay policy blocks sound until a
 * user gesture, and it leaves a lazily-created AudioContext `suspended` so the
 * new-job beep is silent. Call this from the FIRST user gesture (e.g. the login
 * "Verify" tap / first touch on the app root): it creates + resumes the context
 * and plays one near-silent tick so the context is "running" and later beeps
 * actually sound. Safe/no-op off the web.
 */
export function unlockAudio(): void {
  const Ctor = getCtor();
  if (!Ctor) return;
  try {
    if (!ctx) ctx = new Ctor();
    ctx.resume?.().catch(() => undefined);
    // A near-silent tick to fully "warm up" the context under the gesture.
    const c = ctx;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = 440;
    osc.connect(gain);
    gain.connect(c.destination);
    const now = c.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    osc.start(now);
    osc.stop(now + 0.02);
  } catch {
    /* ignore — the banner still shows even if audio can't unlock */
  }
}

/**
 * Start the looping alert. Safe to call repeatedly — if already looping this is
 * a no-op (no double-playing). Returns false if audio is unavailable (e.g. no
 * user gesture yet / native), so callers can still show the visual banner.
 */
export function startAlert(): boolean {
  if (timer != null) return true; // already looping
  const Ctor = getCtor();
  if (!Ctor) return false;
  try {
    if (!ctx) ctx = new Ctor();
    // Autoplay policy may leave the context suspended until a user gesture.
    ctx.resume?.().catch(() => undefined);
    beep();
    timer = setInterval(beep, 1000);
    return true;
  } catch {
    return false;
  }
}

/** Stop the looping alert. */
export function stopAlert(): void {
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
}
