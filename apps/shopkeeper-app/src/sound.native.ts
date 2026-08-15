/**
 * NATIVE (iOS/Android) looping alert sound for new orders. Metro picks this
 * `.native.ts` on native; the web build keeps sound.ts (Web Audio synth). Plays
 * the bundled assets/alert.wav on a loop via expo-av. A module-level singleton
 * keeps it from double-playing if triggered again while already looping.
 */
import { Audio } from 'expo-av';

let sound: Audio.Sound | null = null;
let starting = false;
let generation = 0; // bumped by stopAlert() to cancel an in-flight load

/**
 * No-op on native — foreground audio needs no user-gesture unlock (that's a web
 * autoplay-policy concern only).
 */
export function unlockAudio(): void {}

/**
 * Start the looping alert. Safe to call repeatedly — if already loaded or
 * loading this is a no-op (no double-playing). Returns true synchronously since
 * native can always play; callers only use the boolean to decide whether to
 * show a "silent" banner. The sound itself loads async.
 */
export function startAlert(): boolean {
  if (sound || starting) return true; // already looping / loading
  starting = true;
  const myGen = generation; // if stopAlert() bumps this mid-load, discard the load
  void (async () => {
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, shouldDuckAndroid: true });
      const { sound: s } = await Audio.Sound.createAsync(
        require('../assets/alert.wav'),
        { isLooping: true, shouldPlay: true, volume: 1.0 },
      );
      if (myGen !== generation) {
        // stopAlert() ran while we were loading — tear this one down, don't keep it
        await s.stopAsync().catch(() => {});
        await s.unloadAsync().catch(() => {});
        return;
      }
      sound = s;
      starting = false;
    } catch {
      starting = false;
    }
  })();
  return true;
}

/** Stop the looping alert. Async cleanup is fire-and-forget (contract is sync). */
export function stopAlert(): void {
  generation++; // cancels any load still in flight (see startAlert)
  starting = false;
  const s = sound;
  sound = null;
  if (s) {
    void (async () => {
      await s.stopAsync().catch(() => {});
      await s.unloadAsync().catch(() => {});
    })();
  }
}
