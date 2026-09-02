import { magnitudeSpectrum, planFFT } from '../analysis/fft';
import { DEFAULT_HOP, type Frame, type Peak } from '../analysis/partials';

/**
 * Additive resynthesis: rebuild a sound as a sum of sine waves.
 *
 * Pure -- samples in, samples out. Playing the result is somebody else's job.
 *
 * Two details do most of the work. Partials are matched between frames so a
 * continuing note keeps one oscillator rather than being retriggered, and
 * phase is carried forward continuously. Restarting phase every frame would
 * produce a click at every hop, which is 86 clicks a second.
 */

export interface ResynthOptions {
  hop?: number;
  /** Loudest partials to keep per frame. Fewer is thinner but cheaper. */
  maxPartials?: number;
  gain?: number;
}

interface Voice {
  freq: number;
  amp: number;
  phase: number;
}

/** Pair this frame's peaks with the ongoing voices, nearest in frequency. */
function match(voices: Voice[], peaks: readonly Peak[], tolerance = 1.05): Array<Voice | null> {
  const taken = new Set<number>();
  return peaks.map((peak) => {
    let bestIndex = -1;
    let bestRatio = tolerance;
    voices.forEach((v, i) => {
      if (taken.has(i)) return;
      const ratio = v.freq > peak.freq ? v.freq / peak.freq : peak.freq / v.freq;
      if (ratio < bestRatio) { bestRatio = ratio; bestIndex = i; }
    });
    if (bestIndex >= 0) { taken.add(bestIndex); return voices[bestIndex]; }
    return null;
  });
}

/**
 * Render frames of partials back into audio. Frequencies and amplitudes are
 * interpolated across each hop, so a glide sounds like a glide rather than a
 * staircase. Pure.
 */
export function resynthesize(
  frames: readonly Frame[],
  sampleRate: number,
  opts: ResynthOptions = {},
): Float32Array {
  const { hop = DEFAULT_HOP, maxPartials = 40, gain = 1 } = opts;
  if (!frames.length) return new Float32Array(0);

  const hopSamples = Math.max(1, Math.round(hop * sampleRate));
  const total = hopSamples * frames.length + hopSamples;
  const out = new Float32Array(total);

  let voices: Voice[] = [];

  for (let f = 0; f < frames.length; f++) {
    const peaks = frames[f].peaks.slice(0, maxPartials);
    const paired = match(voices, peaks);
    const next: Voice[] = [];
    const offset = f * hopSamples;

    peaks.forEach((peak, i) => {
      const previous = paired[i];
      // A new partial fades in from silence rather than appearing at full
      // volume, which would be an audible click.
      const startFreq = previous ? previous.freq : peak.freq;
      const startAmp = previous ? previous.amp : 0;
      let phase = previous ? previous.phase : Math.random() * Math.PI * 2;

      for (let n = 0; n < hopSamples; n++) {
        const t = n / hopSamples;
        const freq = startFreq + (peak.freq - startFreq) * t;
        const amp = startAmp + (peak.amp - startAmp) * t;
        phase += (2 * Math.PI * freq) / sampleRate;
        const at = offset + n;
        if (at < out.length) out[at] += Math.sin(phase) * amp * gain;
      }

      // Keep phase inside a sane range so it stays precise over long renders.
      next.push({ freq: peak.freq, amp: peak.amp, phase: phase % (2 * Math.PI) });
    });

    voices = next;
  }

  return out;
}

/**
 * How close two signals are in spectrum, in decibels: 0 is identical, and
 * more negative is further apart.
 *
 * Comparing sample by sample would be wrong -- two sounds identical to the
 * ear can differ completely in phase -- so this compares magnitude spectra
 * frame by frame, which is roughly what hearing does. Pure.
 */
export function spectralDistance(
  a: Float32Array,
  b: Float32Array,
  _sampleRate: number,
  fftSize = 2048,
): number {
  const plan = planFFT(fftSize);
  const frameA = new Float32Array(fftSize);
  const frameB = new Float32Array(fftSize);
  const specA = new Float32Array(fftSize >> 1);
  const specB = new Float32Array(fftSize >> 1);

  const length = Math.min(a.length, b.length);
  const hop = fftSize >> 1;
  let error = 0;
  let signal = 0;

  for (let start = 0; start + fftSize <= length; start += hop) {
    frameA.set(a.subarray(start, start + fftSize));
    frameB.set(b.subarray(start, start + fftSize));
    magnitudeSpectrum(frameA, plan, specA);
    magnitudeSpectrum(frameB, plan, specB);

    for (let i = 0; i < specA.length; i++) {
      const d = specA[i] - specB[i];
      error += d * d;
      signal += specA[i] * specA[i];
    }
  }

  if (signal === 0) return -Infinity;
  return 10 * Math.log10(error / signal);
}

/** Peak amplitude, for checking a render is neither silent nor clipping. Pure. */
export function peakAmplitude(samples: Float32Array): number {
  let max = 0;
  for (const v of samples) max = Math.max(max, Math.abs(v));
  return max;
}
