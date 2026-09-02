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
  /**
   * Global tuning offset in semitones, from estimateTuning. Recordings are
   * often not at A440 -- and uploads get pitch-shifted deliberately -- which
   * shifts every pitch class and wrecks detection if uncorrected.
   */
  tuning = 0,
): Chroma {
  const chroma = new Float32Array(CHROMA_LENGTH);
  const binHz = sampleRate / fftSize;
  const first = Math.max(1, Math.floor(MIN_HZ / binHz));
  const last = Math.min(magnitudes.length - 1, Math.ceil(MAX_HZ / binHz));

  for (let bin = first; bin <= last; bin++) {
    const mag = magnitudes[bin];
    if (mag <= 0) continue;

    const hz = bin * binHz;
    const midi = freqToMidi(hz) - tuning;
    const nearest = Math.round(midi);
    const offset = Math.abs(midi - nearest); // 0 = dead on, 0.5 = worst case

    // Cosine taper: full vote on centre, nothing at the halfway point.
    const centreWeight = Math.cos(offset * Math.PI);
    if (centreWeight <= 0) continue;

    chroma[pitchClass(nearest)] += mag * centreWeight * (1 / hz) * 100;
  }

  return chroma;
}

/**
 * Logarithmic compression, the standard fix for one voice dominating a chroma
 * vector. A bass note two octaves below the chord is both louder and, after
 * the 1/f weighting, further boosted -- so without compression the vector is
 * essentially a single pitch class and every chord looks like a power chord
 * on the right root. That is exactly the failure the benchmark shows: high
 * root recall, poor quality recall.
 *
 * gamma of 0 disables it. Pure.
 */
export function compress(chroma: Chroma, gamma: number): Chroma {
  if (gamma <= 0) return Float32Array.from(chroma);
  const out = new Float32Array(CHROMA_LENGTH);
  const scale = Math.log(1 + gamma);
  for (let i = 0; i < CHROMA_LENGTH; i++) {
    out[i] = Math.log(1 + gamma * chroma[i]) / scale;
  }
  return out;
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

/**
 * Estimate how far the whole recording sits from A440, in semitones.
 *
 * Every spectral peak is a vote: how far it falls from the nearest equal
 * tempered note. Averaged as angles on a circle -- because +0.49 and -0.49
 * semitones are nearly the same tuning, not opposite ones -- the votes agree
 * on the recording's actual reference pitch.
 *
 * Returns a value in (-0.5, 0.5]. Pure.
 */
export function estimateTuning(
  magnitudes: Float32Array | number[],
  sampleRate: number,
  fftSize: number,
): number {
  const binHz = sampleRate / fftSize;
  const first = Math.max(1, Math.floor(MIN_HZ / binHz));
  const last = Math.min(magnitudes.length - 1, Math.ceil(MAX_HZ / binHz));

  let x = 0;
  let y = 0;

  for (let bin = first + 1; bin < last; bin++) {
    const mag = magnitudes[bin];
    if (mag <= 0) continue;
    // Only local maxima: bins on the flank of a peak carry no tuning news.
    if (mag < magnitudes[bin - 1] || mag < magnitudes[bin + 1]) continue;

    const midi = freqToMidi(bin * binHz);
    const deviation = midi - Math.round(midi); // -0.5..0.5 semitones

    // Wrap onto a full circle so the mean is not dragged across the seam.
    const angle = deviation * 2 * Math.PI;
    const weight = mag / (bin * binHz);
    x += Math.cos(angle) * weight;
    y += Math.sin(angle) * weight;
  }

  if (x === 0 && y === 0) return 0;
  return Math.atan2(y, x) / (2 * Math.PI);
}
