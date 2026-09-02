import { midiToFreq } from '../theory/pitch';

/**
 * Playback. One of only three impure modules in the app -- it owns an
 * AudioContext and nothing else does.
 */

let ctx: AudioContext | null = null;

/** Drop the cached context, so tests can install a fake one. */
export function resetAudioContext(): void {
  ctx = null;
}

/** Browsers require a user gesture before audio starts. */
export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export interface VoiceOptions {
  wave?: OscillatorType;
  duration?: number;
  gain?: number;
  /** Seconds from now. */
  when?: number;
}

/**
 * A single note with an ADSR-ish envelope. Without the ramps you get a click
 * at both ends, because an abrupt gain change is itself a broadband transient.
 */
export function playNote(midi: number, opts: VoiceOptions = {}): void {
  const { wave = 'triangle', duration = 0.6, gain = 0.2, when = 0 } = opts;
  const ac = audioContext();
  const t0 = ac.currentTime + when;

  const osc = ac.createOscillator();
  const env = ac.createGain();

  osc.type = wave;
  osc.frequency.value = midiToFreq(midi);

  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.015);            // attack
  env.gain.exponentialRampToValueAtTime(gain * 0.7, t0 + 0.12);  // decay
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);  // release

  osc.connect(env).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/** All notes together. Gain is divided so a seventh is not louder than a triad. */
export function playChord(notes: number[], opts: VoiceOptions = {}): void {
  const gain = (opts.gain ?? 0.2) / Math.max(1, notes.length * 0.7);
  notes.forEach((n) => playNote(n, { ...opts, gain }));
}

/** Notes in sequence -- how you actually hear what a chord is made of. */
export function playArpeggio(notes: number[], opts: VoiceOptions & { step?: number } = {}): void {
  const { step = 0.16 } = opts;
  notes.forEach((n, i) => playNote(n, { ...opts, when: (opts.when ?? 0) + i * step }));
}

/** Up and back down, the standard way to audition a scale. */
export function playScale(notes: number[], opts: VoiceOptions & { step?: number } = {}): void {
  const { step = 0.18 } = opts;
  const updown = [...notes, notes[0] + 12, ...[...notes].reverse()];
  updown.forEach((n, i) =>
    playNote(n, { ...opts, duration: 0.35, when: (opts.when ?? 0) + i * step }));
}

export function playProgression(
  chords: number[][],
  opts: VoiceOptions & { beat?: number } = {},
): void {
  const { beat = 0.9 } = opts;
  chords.forEach((notes, i) =>
    playChord(notes, { ...opts, duration: beat * 0.95, when: (opts.when ?? 0) + i * beat }));
}
