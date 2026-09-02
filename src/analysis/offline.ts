import {
  chromaFromSpectrum, compress, energy, estimateTuning, normalize, smooth, type Chroma,
} from './chroma';
import { buildTemplates, detectChord, HARMONIC_LEAK } from './detect';
import { magnitudeSpectrum, planFFT } from './fft';
import { HOP, type Observation } from './timeline';

/**
 * Offline re-analysis: PCM in, observations out, with no clock and no audio
 * graph involved. Realtime capture is at the mercy of the event loop and
 * drops frames under load; this sees every sample, at whatever hop we ask
 * for, and gives the same answer every time it runs.
 */

export const OFFLINE_FFT_SIZE = 8192;

/** Log-compression strength. Chosen by sweep; see src/testing/sweep.test.ts. */
export const DEFAULT_GAMMA = 1;

export interface OfflineOptions {
  hop?: number;
  fftSize?: number;
  gate?: number;
  /** Frames of context before a chord is believed. */
  window?: number;
  /** Maps a position in the recording to a position in the song. */
  toSongTime?: (recordingTime: number) => number;
  /**
   * Global tuning offset in semitones. Omit to estimate it from the audio,
   * which is almost always what you want.
   */
  tuning?: number;
  /** Harmonic leakage modelled in the chord templates. For benchmarking. */
  leak?: number;
  /** Log-compression strength, to stop one loud voice dominating. */
  gamma?: number;
  /** Evidence an extra note needs, relative to the triad tones. */
  support?: number;
  /** Penalty for an extra note the audio does not support. */
  penalty?: number;
}

/**
 * Estimate a recording's tuning by sampling frames across its whole length.
 * One frame is not enough -- a single chord's harmonics bias the answer --
 * but the median over the recording is stable. Pure.
 */
export function estimateTrackTuning(
  samples: Float32Array,
  sampleRate: number,
  fftSize = OFFLINE_FFT_SIZE,
  probes = 24,
): number {
  const plan = planFFT(fftSize);
  const frame = new Float32Array(fftSize);
  const spectrum = new Float32Array(fftSize >> 1);
  const votes: number[] = [];

  const usable = samples.length - fftSize;
  if (usable <= 0) return 0;

  for (let i = 0; i < probes; i++) {
    const start = Math.floor((usable * i) / Math.max(1, probes - 1));
    frame.set(samples.subarray(start, start + fftSize));
    magnitudeSpectrum(frame, plan, spectrum);
    votes.push(estimateTuning(spectrum, sampleRate, fftSize));
  }

  votes.sort((a, b) => a - b);
  return votes[votes.length >> 1];
}

/** Analyse a whole recording. Pure: same samples in, same observations out. */
export function analyseBuffer(
  samples: Float32Array,
  sampleRate: number,
  opts: OfflineOptions = {},
): Observation[] {
  const {
    hop = HOP,
    fftSize = OFFLINE_FFT_SIZE,
    gate = 0.00001,
    window = 4,
    gamma = DEFAULT_GAMMA,
    toSongTime = (t) => t,
  } = opts;

  const tuning = opts.tuning ?? estimateTrackTuning(samples, sampleRate, fftSize);
  const templates = opts.leak === undefined || opts.leak === HARMONIC_LEAK
    ? undefined
    : buildTemplates(opts.leak);

  const plan = planFFT(fftSize);
  const hopSamples = Math.max(1, Math.round(hop * sampleRate));
  const spectrum = new Float32Array(fftSize >> 1);
  const frame = new Float32Array(fftSize);
  const recent: Chroma[] = [];
  const out: Observation[] = [];

  for (let start = 0; start + fftSize <= samples.length; start += hopSamples) {
    frame.set(samples.subarray(start, start + fftSize));
    magnitudeSpectrum(frame, plan, spectrum);

    const raw = chromaFromSpectrum(spectrum, sampleRate, fftSize, tuning);
    if (energy(raw) <= gate) {
      recent.length = 0;
      continue;
    }

    // Compress after normalising, so gamma means the same thing at any volume.
    recent.push(compress(normalize(raw), gamma));
    if (recent.length > window) recent.shift();

    const candidate = detectChord(smooth(recent), templates, opts.support, opts.penalty);
    if (candidate) {
      out.push({ time: toSongTime(start / sampleRate), candidate });
    }
  }

  return out;
}

/** Average the channels of a multi-channel recording down to mono. Pure. */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const length = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i];
    out[i] = sum / channels.length;
  }
  return out;
}
