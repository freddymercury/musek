import { midiToFreq } from '../theory/pitch';

/**
 * Audio renderers for evaluation. Pure: given the same arguments and seed,
 * every function here returns identical samples, so benchmark numbers move
 * only when the analyser changes.
 *
 * These deliberately get harder than a clean sine. Real recordings carry
 * bass an octave or two below the chord, drums that are broadband noise,
 * inversions that put the third in the bass, and -- especially on YouTube --
 * a global tuning that is not A440.
 */

export const RATE = 44100;

/** Deterministic PRNG, so "noise" is reproducible across runs. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}

export interface ToneOptions {
  /** Relative level of each harmonic, starting at the fundamental. */
  harmonics?: number[];
  gain?: number;
  /** Multiply every frequency, e.g. to detune the whole track. */
  tuning?: number;
}

const DEFAULT_HARMONICS = [1, 0.5, 0.33, 0.22, 0.16, 0.1, 0.08, 0.05];

export function tone(midi: number, seconds: number, opts: ToneOptions = {}): Float32Array {
  const { harmonics = DEFAULT_HARMONICS, gain = 1, tuning = 1 } = opts;
  const freq = midiToFreq(midi) * tuning;
  const out = new Float32Array(Math.floor(seconds * RATE));
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    let v = 0;
    for (let h = 0; h < harmonics.length; h++) {
      const f = freq * (h + 1);
      if (f > RATE / 2) break;
      v += harmonics[h] * Math.sin(2 * Math.PI * f * t);
    }
    // Gentle decay, so notes behave like plucked strings rather than organ.
    out[i] = v * gain * Math.exp(-1.1 * t);
  }
  return out;
}

export function mix(parts: Float32Array[]): Float32Array {
  const length = Math.max(0, ...parts.map((p) => p.length));
  const out = new Float32Array(length);
  for (const p of parts) for (let i = 0; i < p.length; i++) out[i] += p[i];
  return out;
}

export function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Scale so the loudest sample sits at `peak`. Pure. */
export function normalizeAudio(samples: Float32Array, peak = 0.9): Float32Array {
  let max = 0;
  for (const v of samples) max = Math.max(max, Math.abs(v));
  const out = new Float32Array(samples.length);
  if (max === 0) return out;
  const k = peak / max;
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * k;
  return out;
}

/** Broadband hiss, standing in for cymbals and room tone. */
export function noise(seconds: number, gain: number, seed = 1): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(Math.floor(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = (rand() * 2 - 1) * gain;
  return out;
}

/** A kick-and-snare pulse train: transients that smear across every bin. */
export function drums(seconds: number, bpm: number, gain: number, seed = 7): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(Math.floor(seconds * RATE));
  const beat = 60 / bpm;
  for (let b = 0; b * beat < seconds; b++) {
    const start = Math.floor(b * beat * RATE);
    const snare = b % 2 === 1;
    const len = Math.floor((snare ? 0.09 : 0.13) * RATE);
    for (let i = 0; i < len && start + i < out.length; i++) {
      const t = i / RATE;
      const env = Math.exp(-(snare ? 34 : 26) * t);
      const body = snare
        ? (rand() * 2 - 1)
        : Math.sin(2 * Math.PI * (110 * Math.exp(-24 * t)) * t);
      out[start + i] += body * env * gain;
    }
  }
  return out;
}

export interface ChordRenderOptions {
  seconds?: number;
  /** Add a bass note an octave or two below the root. */
  bass?: boolean;
  /** Voice the chord in an inversion. */
  inversion?: number;
  /** Global detune factor, e.g. 2 ** (0.5/12) for 50 cents sharp. */
  tuning?: number;
  gain?: number;
}

/** Render one chord as an instrument would voice it. Pure. */
export function renderChord(notes: number[], opts: ChordRenderOptions = {}): Float32Array {
  const { seconds = 1, bass = false, inversion = 0, tuning = 1, gain = 1 } = opts;

  const voiced = [...notes];
  for (let i = 0; i < inversion; i++) voiced.push(voiced.shift()! + 12);

  const parts = voiced.map((n) => tone(n, seconds, { tuning, gain: gain * 0.8 }));
  if (bass) {
    // Bass carries a strong fundamental and few upper harmonics.
    parts.push(tone(notes[0] - 24, seconds, {
      tuning,
      gain: gain * 1.4,
      harmonics: [1, 0.35, 0.12],
    }));
  }
  return mix(parts);
}

export interface TrackOptions extends ChordRenderOptions {
  bpm?: number;
  drumGain?: number;
  noiseGain?: number;
  seed?: number;
}

export interface RenderedTrack {
  samples: Float32Array;
  /** Ground truth: which chord sounds when. */
  truth: Array<{ start: number; end: number; symbol: string }>;
}

/** Render a chord progression into audio plus its ground-truth annotation. */
export function renderTrack(
  chords: Array<{ notes: number[]; symbol: string }>,
  opts: TrackOptions = {},
): RenderedTrack {
  const {
    seconds = 1, bpm = 100, drumGain = 0, noiseGain = 0, seed = 3, ...chordOpts
  } = opts;

  const blocks = chords.map((c) => renderChord(c.notes, { ...chordOpts, seconds }));
  const music = concat(blocks);
  const total = music.length / RATE;

  const layers = [music];
  if (drumGain > 0) layers.push(drums(total, bpm, drumGain, seed));
  if (noiseGain > 0) layers.push(noise(total, noiseGain, seed + 1));

  const truth = chords.map((c, i) => ({
    start: i * seconds,
    end: (i + 1) * seconds,
    symbol: c.symbol,
  }));

  return { samples: normalizeAudio(mix(layers)), truth };
}
