import { magnitudeSpectrum, planFFT, type FFTPlan } from './fft';

/**
 * Sinusoidal analysis: describing a sound as a set of sine waves whose
 * frequency and amplitude change over time.
 *
 * This is the article's first premise taken literally. A sound is a number
 * changing over time; a vibrating string produces a harmonic series; and
 * different waveforms are different recipes of those harmonics. If timbre is
 * a recipe, then measuring the recipe and rebuilding from it should give back
 * the tone -- not a generic wave labelled with the right note.
 *
 * Pure throughout: samples in, partials out, no audio graph involved.
 */

export interface Peak {
  /** Frequency in Hz, interpolated between bins. */
  freq: number;
  /** Linear magnitude. */
  amp: number;
}

/** One analysis frame: what was sounding, and at what strength. */
export interface Frame {
  /** Seconds from the start of the analysed audio. */
  time: number;
  peaks: Peak[];
}

/**
 * Coherent gain of the Hann window used in the transform.
 *
 * A Hann window sums to half its length, so a sinusoid of amplitude A shows
 * up in the spectrum at A/2. Resynthesising from the uncorrected figure
 * rebuilds the sound at half amplitude -- right timbre, right pitch, audibly
 * quiet, and a reconstruction error that never drops below about -6dB.
 */
export const WINDOW_COHERENT_GAIN = 0.5;

export const DEFAULT_FFT = 4096;
export const DEFAULT_HOP = 0.0116; // ~512 samples at 44.1k

/**
 * Find spectral peaks, refining each to sub-bin accuracy.
 *
 * A bin is 10Hz wide at this FFT size, which is more than a semitone at the
 * bottom of the piano, so taking the bin centre would detune everything.
 * Fitting a parabola through the peak and its neighbours recovers the true
 * frequency, which is what makes resynthesis sound in tune rather than sour.
 *
 * Pure.
 */
export function findPeaks(
  magnitudes: Float32Array,
  sampleRate: number,
  fftSize: number,
  maxPeaks = 40,
  floor = 1e-5,
): Peak[] {
  const binHz = sampleRate / fftSize;
  const peaks: Peak[] = [];

  for (let i = 1; i < magnitudes.length - 1; i++) {
    const mag = magnitudes[i];
    if (mag < floor) continue;
    if (mag <= magnitudes[i - 1] || mag <= magnitudes[i + 1]) continue;

    // Parabolic interpolation over the log magnitudes of the three bins.
    const a = Math.log(Math.max(magnitudes[i - 1], 1e-12));
    const b = Math.log(Math.max(mag, 1e-12));
    const c = Math.log(Math.max(magnitudes[i + 1], 1e-12));
    const denom = a - 2 * b + c;
    const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
    const clamped = Math.max(-0.5, Math.min(0.5, shift));

    peaks.push({
      freq: (i + clamped) * binHz,
      amp: Math.exp(b - 0.25 * (a - c) * clamped) / WINDOW_COHERENT_GAIN,
    });
  }

  return peaks.sort((x, y) => y.amp - x.amp).slice(0, maxPeaks);
}

export interface PartialOptions {
  fftSize?: number;
  hop?: number;
  maxPeaks?: number;
  floor?: number;
}

/** Analyse a whole signal into frames of partials. Pure. */
export function analysePartials(
  samples: Float32Array,
  sampleRate: number,
  opts: PartialOptions = {},
): Frame[] {
  const {
    fftSize = DEFAULT_FFT,
    hop = DEFAULT_HOP,
    maxPeaks = 40,
    floor = 1e-5,
  } = opts;

  const plan: FFTPlan = planFFT(fftSize);
  const hopSamples = Math.max(1, Math.round(hop * sampleRate));
  const frame = new Float32Array(fftSize);
  const spectrum = new Float32Array(fftSize >> 1);
  const frames: Frame[] = [];

  for (let start = 0; start + fftSize <= samples.length; start += hopSamples) {
    frame.set(samples.subarray(start, start + fftSize));
    magnitudeSpectrum(frame, plan, spectrum);
    frames.push({
      time: start / sampleRate,
      peaks: findPeaks(spectrum, sampleRate, fftSize, maxPeaks, floor),
    });
  }

  return frames;
}

/**
 * The harmonic recipe of a sound: how loud each overtone is relative to the
 * fundamental. This is what the article means by timbre -- a sine, triangle,
 * square and sawtooth at the same pitch differ only in these numbers.
 *
 * Pure.
 */
export function harmonicRecipe(
  peaks: readonly Peak[],
  fundamental: number,
  count = 8,
  toleranceCents = 60,
): number[] {
  const recipe = new Array(count).fill(0);
  if (fundamental <= 0) return recipe;

  const tolerance = Math.pow(2, toleranceCents / 1200);

  for (let h = 1; h <= count; h++) {
    const target = fundamental * h;
    let best = 0;
    for (const p of peaks) {
      const ratio = p.freq > target ? p.freq / target : target / p.freq;
      if (ratio <= tolerance && p.amp > best) best = p.amp;
    }
    recipe[h - 1] = best;
  }

  const strongest = Math.max(...recipe);
  return strongest > 0 ? recipe.map((v) => v / strongest) : recipe;
}

/**
 * Estimate the fundamental from a set of peaks by harmonic scoring: the true
 * fundamental is the candidate whose integer multiples explain the most
 * energy. Picking the loudest peak instead would lock onto whichever overtone
 * happened to be strongest. Pure.
 */
export function estimateFundamental(
  peaks: readonly Peak[],
  minHz = 55,
  maxHz = 1200,
): number {
  if (!peaks.length) return 0;

  let bestFreq = 0;
  let bestScore = -1;

  for (const candidate of peaks) {
    if (candidate.freq < minHz || candidate.freq > maxHz) continue;

    let score = 0;
    for (let h = 1; h <= 8; h++) {
      const target = candidate.freq * h;
      for (const p of peaks) {
        const ratio = p.freq > target ? p.freq / target : target / p.freq;
        if (ratio <= 1.03) { score += p.amp / h; break; }
      }
    }

    if (score > bestScore) { bestScore = score; bestFreq = candidate.freq; }
  }

  return bestFreq;
}

/**
 * The classic waveforms as harmonic recipes, which is all they really are.
 *
 * The article's point: a sine, triangle, square and sawtooth at the same
 * pitch are the same note and sound completely different, because each is a
 * different amount of each overtone. Naming the nearest one puts a word to
 * the timbre a recording actually has.
 */
export const WAVEFORMS: Record<string, number[]> = {
  // Nothing above the fundamental.
  sine: [1, 0, 0, 0, 0, 0, 0, 0],
  // Odd harmonics falling as 1/n^2: soft and flute-like.
  triangle: [1, 0, 1 / 9, 0, 1 / 25, 0, 1 / 49, 0],
  // Odd harmonics falling as 1/n: hollow, clarinet-like.
  square: [1, 0, 1 / 3, 0, 1 / 5, 0, 1 / 7, 0],
  // Every harmonic falling as 1/n: bright and buzzy, like strings or brass.
  sawtooth: [1, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 6, 1 / 7, 1 / 8],
};

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface WaveformMatch {
  name: string;
  similarity: number;
}

/** Which classic waveform a measured recipe most resembles. Pure. */
export function nearestWaveform(recipe: readonly number[]): WaveformMatch {
  let best: WaveformMatch = { name: 'sine', similarity: -1 };
  for (const [name, ideal] of Object.entries(WAVEFORMS)) {
    const similarity = cosine(recipe, ideal);
    if (similarity > best.similarity) best = { name, similarity };
  }
  return best;
}

/**
 * Brightness: how much energy sits above the fundamental. Low is mellow,
 * high is buzzy. Pure.
 */
export function brightness(recipe: readonly number[]): number {
  const total = recipe.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return (total - recipe[0]) / total;
}
