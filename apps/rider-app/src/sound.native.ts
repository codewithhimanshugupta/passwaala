/**
 * NATIVE (iOS/Android) looping alert sound for new delivery jobs. Metro picks
 * this `.native.ts` on native; the web build keeps sound.ts (Web Audio API bell
 * synth). Plays the bundled assets/alert.wav on loop via expo-av. A module-level
 * singleton keeps it from double-playing if triggered again while already looping.
 */
import { Audio } from 'expo-av';

let sound: Audio.Sound | null = null;
let starting = false;
let generation = 0; // bumped by stopAlert() to cancel an in-flight load

/**
 * Unlock audio for later autoplay — a web-only concern (browser autoplay
 * policy). Native has no such gate, so this is a no-op.
 */
export function unlockAudio(): void {
  /* no-op on native */
}

/**
 * Start the looping alert. Safe to call repeatedly — if already playing (or
 * mid-start) this is a no-op. Kicks off the async load/play and returns true
 * synchronously so callers always show the visual banner.
 */
export function startAlert(): boolean {
  if (sound || starting) return true; // already looping / starting
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

/** Stop the looping alert. Fire-and-forget cleanup; synchronous signature. */
export function stopAlert(): void {
  generation++; // cancels any load still in flight (see startAlert)
  if (sound) {
    const s = sound;
    sound = null;
    void s.stopAsync().catch(() => {});
    void s.unloadAsync().catch(() => {});
  }
  starting = false;
}
