import { freqToMidi, pitchClass } from '../theory/pitch';

/**
 * A chroma vector (or pitch-class profile): how much energy the signal has
 * in each of the twelve pitch classes, octave collapsed. This is the bridge
 * between audio and theory -- once a spectrum is a chroma vector, every
 * question we want to ask is a comparison against a chord or scale template.
 */
export type Chroma = Float32Array; // length 12, C = 0

export const CHROMA_LENGTH = 12;

/** Ignore anything below this -- bass fundamentals and rumble smear the profile. */
export const MIN_HZ = 65;   // ~C2
export const MAX_HZ = 2100; // ~C7, above which harmonics dominate

/**
 * Fold an FFT magnitude spectrum into twelve pitch classes.
 *
 * Each bin is assigned to the pitch class it is nearest to, weighted down by
 * how far off-centre it sits, so a bin sitting between two semitones does not
 * vote at full strength for either. Bins are also weighted by 1/f, because
 * without it the harmonics of low notes outvote the notes actually being
 * played.
 */
export function chromaFromSpectrum(
  magnitudes: Float32Array | number[],
  sampleRate: number,
  fftSize: number,
): Chroma {
  const chroma = new Float32Array(CHROMA_LENGTH);
  const binHz = sampleRate / fftSize;
  const first = Math.max(1, Math.floor(MIN_HZ / binHz));
  const last = Math.min(magnitudes.length - 1, Math.ceil(MAX_HZ / binHz));

  for (let bin = first; bin <= last; bin++) {
    const mag = magnitudes[bin];
    if (mag <= 0) continue;

    const hz = bin * binHz;
    const midi = freqToMidi(hz);
    const nearest = Math.round(midi);
    const offset = Math.abs(midi - nearest); // 0 = dead on, 0.5 = worst case

    // Cosine taper: full vote on centre, nothing at the halfway point.
    const centreWeight = Math.cos(offset * Math.PI);
    if (centreWeight <= 0) continue;

    chroma[pitchClass(nearest)] += mag * centreWeight * (1 / hz) * 100;
  }

  return chroma;
}

/** Scale to unit maximum so frames are comparable regardless of volume. */
export function normalize(chroma: Chroma): Chroma {
  let max = 0;
  for (const v of chroma) if (v > max) max = v;
  const out = new Float32Array(CHROMA_LENGTH);
  if (max === 0) return out;
  for (let i = 0; i < CHROMA_LENGTH; i++) out[i] = chroma[i] / max;
  return out;
}

/** Running average, so a chord has to persist to register. */
export function smooth(frames: Chroma[]): Chroma {
  const out = new Float32Array(CHROMA_LENGTH);
  if (!frames.length) return out;
  for (const f of frames) {
    for (let i = 0; i < CHROMA_LENGTH; i++) out[i] += f[i];
  }
  for (let i = 0; i < CHROMA_LENGTH; i++) out[i] /= frames.length;
  return out;
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < CHROMA_LENGTH; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Total energy, for gating out silence. */
export function energy(chroma: Chroma): number {
  let sum = 0;
  for (const v of chroma) sum += v;
  return sum;
}

/** Build a chroma vector directly from pitch classes -- used for templates and tests. */
export function chromaOf(pcs: number[], weights?: number[]): Chroma {
  const c = new Float32Array(CHROMA_LENGTH);
  pcs.forEach((pc, i) => { c[pitchClass(pc)] = weights?.[i] ?? 1; });
  return c;
}
