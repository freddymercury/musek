import { chromaFromSpectrum, energy, smooth, type Chroma } from './chroma';
import { detectChord } from './detect';
import { magnitudeSpectrum, planFFT } from './fft';
import { HOP, type Observation } from './timeline';

/**
 * Offline re-analysis: PCM in, observations out, with no clock and no audio
 * graph involved. Realtime capture is at the mercy of the event loop and
 * drops frames under load; this sees every sample, at whatever hop we ask
 * for, and gives the same answer every time it runs.
 */

export const OFFLINE_FFT_SIZE = 8192;

export interface OfflineOptions {
  hop?: number;
  fftSize?: number;
  gate?: number;
  /** Frames of context before a chord is believed. */
  window?: number;
  /** Maps a position in the recording to a position in the song. */
  toSongTime?: (recordingTime: number) => number;
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
    toSongTime = (t) => t,
  } = opts;

  const plan = planFFT(fftSize);
  const hopSamples = Math.max(1, Math.round(hop * sampleRate));
  const spectrum = new Float32Array(fftSize >> 1);
  const frame = new Float32Array(fftSize);
  const recent: Chroma[] = [];
  const out: Observation[] = [];

  for (let start = 0; start + fftSize <= samples.length; start += hopSamples) {
    frame.set(samples.subarray(start, start + fftSize));
    magnitudeSpectrum(frame, plan, spectrum);

    const chroma = chromaFromSpectrum(spectrum, sampleRate, fftSize);
    if (energy(chroma) <= gate) {
      recent.length = 0;
      continue;
    }

    recent.push(chroma);
    if (recent.length > window) recent.shift();

    const candidate = detectChord(smooth(recent));
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
