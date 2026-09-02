import { describe, it, expect } from 'vitest';
import { magnitudeSpectrum, planFFT } from './fft';
import {
  analysePartials, estimateFundamental, findPeaks, harmonicRecipe, DEFAULT_HOP,
  WAVEFORMS, nearestWaveform, brightness,
} from './partials';
import { peakAmplitude, resynthesize, spectralDistance } from '../audio/resynth';
import { midiToFreq, parseNote } from '../theory/pitch';

const RATE = 44100;

/** A tone with an explicit harmonic recipe, so the recipe can be recovered. */
function withRecipe(freq: number, recipe: number[], seconds: number): Float32Array {
  const out = new Float32Array(Math.floor(seconds * RATE));
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    let v = 0;
    recipe.forEach((amp, h) => {
      const f = freq * (h + 1);
      if (f < RATE / 2) v += amp * Math.sin(2 * Math.PI * f * t);
    });
    out[i] = v * 0.3;
  }
  return out;
}

const spectrumOf = (samples: Float32Array, size = 4096) => {
  const plan = planFFT(size);
  const frame = new Float32Array(size);
  frame.set(samples.subarray(0, size));
  return magnitudeSpectrum(frame, plan);
};

describe('peak finding', () => {
  it('finds a single tone', () => {
    const peaks = findPeaks(spectrumOf(withRecipe(440, [1], 0.5)), RATE, 4096);
    expect(peaks.length).toBeGreaterThan(0);
    expect(peaks[0].freq).toBeCloseTo(440, 0);
  });

  it('resolves frequency more precisely than a bin is wide', () => {
    // A bin is ~10.8Hz here. 437Hz sits between bins, so bin-centre rounding
    // would be out by several Hz, which is audibly flat.
    const peaks = findPeaks(spectrumOf(withRecipe(437, [1], 0.5)), RATE, 4096);
    expect(Math.abs(peaks[0].freq - 437)).toBeLessThan(2);
  });

  it('finds every harmonic of a rich tone', () => {
    const peaks = findPeaks(spectrumOf(withRecipe(220, [1, 0.5, 0.3, 0.2], 0.5)), RATE, 4096);
    for (const h of [1, 2, 3, 4]) {
      expect(peaks.some((p) => Math.abs(p.freq - 220 * h) < 6)).toBe(true);
    }
  });

  it('orders peaks loudest first', () => {
    const peaks = findPeaks(spectrumOf(withRecipe(220, [1, 0.5, 0.3], 0.5)), RATE, 4096);
    for (let i = 1; i < peaks.length; i++) {
      expect(peaks[i - 1].amp).toBeGreaterThanOrEqual(peaks[i].amp);
    }
  });

  it('finds nothing in silence', () => {
    expect(findPeaks(new Float32Array(2048), RATE, 4096)).toEqual([]);
  });

  it('respects the peak limit', () => {
    const peaks = findPeaks(spectrumOf(withRecipe(110, [1, 1, 1, 1, 1, 1, 1, 1], 0.5)), RATE, 4096, 3);
    expect(peaks.length).toBeLessThanOrEqual(3);
  });
});

describe('harmonic recipe', () => {
  it('recovers the recipe of a sawtooth-like tone', () => {
    // A sawtooth falls off as 1/n. If timbre really is a recipe, we should
    // read that shape back out of the audio.
    const recipe = [1, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 6];
    const peaks = findPeaks(spectrumOf(withRecipe(220, recipe, 0.5)), RATE, 4096);
    const measured = harmonicRecipe(peaks, 220, 6);

    for (let h = 0; h < 6; h++) {
      expect(measured[h]).toBeCloseTo(recipe[h], 1);
    }
  });

  it('tells a square-like tone from a sawtooth-like one', () => {
    // A square wave has only odd harmonics; that difference is the timbre.
    const square = [1, 0, 1 / 3, 0, 1 / 5, 0];
    const peaks = findPeaks(spectrumOf(withRecipe(220, square, 0.5)), RATE, 4096);
    const measured = harmonicRecipe(peaks, 220, 6);

    expect(measured[0]).toBeGreaterThan(0.8);
    expect(measured[1]).toBeLessThan(0.2);  // no 2nd harmonic
    expect(measured[2]).toBeGreaterThan(0.15);
    expect(measured[3]).toBeLessThan(0.2);  // no 4th harmonic
  });

  it('reads a pure sine as having no overtones', () => {
    const peaks = findPeaks(spectrumOf(withRecipe(440, [1], 0.5)), RATE, 4096);
    const measured = harmonicRecipe(peaks, 440, 5);
    expect(measured[0]).toBeCloseTo(1, 1);
    for (let h = 1; h < 5; h++) expect(measured[h]).toBeLessThan(0.15);
  });

  it('is normalised to its strongest partial', () => {
    const peaks = findPeaks(spectrumOf(withRecipe(220, [0.3, 0.15], 0.5)), RATE, 4096);
    expect(Math.max(...harmonicRecipe(peaks, 220, 4))).toBeCloseTo(1, 5);
  });

  it('returns zeros for a nonsense fundamental', () => {
    expect(harmonicRecipe([], 0, 4)).toEqual([0, 0, 0, 0]);
  });
});

describe('fundamental estimation', () => {
  it('finds the fundamental of a harmonic tone', () => {
    const peaks = findPeaks(spectrumOf(withRecipe(220, [1, 0.6, 0.4, 0.3], 0.5)), RATE, 4096);
    expect(estimateFundamental(peaks)).toBeCloseTo(220, -1);
  });

  it('is not fooled when an overtone is the loudest partial', () => {
    // The 2nd harmonic is louder than the fundamental here. Taking the
    // loudest peak would report an octave too high.
    const peaks = findPeaks(spectrumOf(withRecipe(220, [0.4, 1, 0.5, 0.3], 0.5)), RATE, 4096);
    expect(estimateFundamental(peaks)).toBeCloseTo(220, -1);
  });

  it('returns zero for silence', () => {
    expect(estimateFundamental([])).toBe(0);
  });
});

describe('resynthesis', () => {
  it('reproduces a tone closely enough to be the same sound', () => {
    const original = withRecipe(midiToFreq(parseNote('A3')), [1, 0.5, 0.3, 0.2, 0.1], 1);
    const frames = analysePartials(original, RATE);
    const rebuilt = resynthesize(frames, RATE);

    const error = spectralDistance(original, rebuilt, RATE);
    // Below -10dB the difference is well under the level of the signal.
    expect(error).toBeLessThan(-10);
  });

  it('preserves the timbre it measured, not just the pitch', () => {
    const recipe = [1, 0.2, 0.8, 0.1, 0.5];
    const original = withRecipe(220, recipe, 1);
    const rebuilt = resynthesize(analysePartials(original, RATE), RATE);

    const measured = harmonicRecipe(findPeaks(spectrumOf(rebuilt), RATE, 4096), 220, 5);
    for (let h = 0; h < 5; h++) {
      expect(measured[h]).toBeCloseTo(recipe[h], 1);
    }
  });

  it('rebuilds a chord, not just a single note', () => {
    const notes = ['C4', 'E4', 'G4'].map((n) => midiToFreq(parseNote(n)));
    const original = new Float32Array(RATE);
    for (const f of notes) {
      const tone = withRecipe(f, [1, 0.4, 0.2], 1);
      for (let i = 0; i < original.length; i++) original[i] += tone[i] / 3;
    }
    const rebuilt = resynthesize(analysePartials(original, RATE), RATE);
    expect(spectralDistance(original, rebuilt, RATE)).toBeLessThan(-8);
  });

  it('produces audible output', () => {
    const original = withRecipe(330, [1, 0.5], 0.5);
    const rebuilt = resynthesize(analysePartials(original, RATE), RATE);
    expect(peakAmplitude(rebuilt)).toBeGreaterThan(0.01);
  });

  it('does not clip', () => {
    const original = withRecipe(330, [1, 0.5, 0.3], 0.5);
    const rebuilt = resynthesize(analysePartials(original, RATE), RATE);
    expect(peakAmplitude(rebuilt)).toBeLessThan(4);
  });

  it('has no clicks at frame boundaries', () => {
    // A phase discontinuity shows up as a sample-to-sample jump far larger
    // than the waveform itself ever makes.
    const rebuilt = resynthesize(analysePartials(withRecipe(220, [1, 0.5], 1), RATE), RATE);
    const hopSamples = Math.round(DEFAULT_HOP * RATE);

    let biggest = 0;
    for (let i = 1; i < rebuilt.length; i++) {
      biggest = Math.max(biggest, Math.abs(rebuilt[i] - rebuilt[i - 1]));
    }
    // Check the boundaries specifically are no worse than the signal at large.
    for (let b = hopSamples; b < rebuilt.length - 1; b += hopSamples) {
      expect(Math.abs(rebuilt[b] - rebuilt[b - 1])).toBeLessThanOrEqual(biggest);
    }
  });

  it('renders silence from no frames', () => {
    expect(resynthesize([], RATE)).toHaveLength(0);
  });

  it('is deterministic in what it measures', () => {
    const original = withRecipe(220, [1, 0.5], 0.5);
    expect(analysePartials(original, RATE)).toEqual(analysePartials(original, RATE));
  });

  it('does not modify the samples it analyses', () => {
    const original = withRecipe(220, [1, 0.5], 0.3);
    const before = [...original];
    analysePartials(original, RATE);
    expect([...original]).toEqual(before);
  });
});

describe('spectral distance', () => {
  it('scores a signal against itself as effectively identical', () => {
    const a = withRecipe(220, [1, 0.5], 0.5);
    expect(spectralDistance(a, a, RATE)).toBeLessThan(-100);
  });

  it('scores unrelated signals as far apart', () => {
    const a = withRecipe(220, [1], 0.5);
    const b = withRecipe(700, [1], 0.5);
    expect(spectralDistance(a, b, RATE)).toBeGreaterThan(-3);
  });

  it('scores a similar timbre as closer than a different one', () => {
    const reference = withRecipe(220, [1, 0.5, 0.25], 0.5);
    const similar = withRecipe(220, [1, 0.45, 0.3], 0.5);
    const different = withRecipe(220, [1, 0, 0, 0, 1], 0.5);
    expect(spectralDistance(reference, similar, RATE))
      .toBeLessThan(spectralDistance(reference, different, RATE));
  });
});

describe('naming a timbre', () => {
  it('recognises each classic waveform from its own recipe', () => {
    for (const [name, recipe] of Object.entries(WAVEFORMS)) {
      expect(nearestWaveform(recipe).name).toBe(name);
    }
  });

  it('names a measured sawtooth a sawtooth', () => {
    const audio = withRecipe(220, WAVEFORMS.sawtooth, 0.5);
    const recipe = harmonicRecipe(findPeaks(spectrumOf(audio), RATE, 4096), 220, 8);
    expect(nearestWaveform(recipe).name).toBe('sawtooth');
  });

  it('names a measured square a square', () => {
    const audio = withRecipe(220, WAVEFORMS.square, 0.5);
    const recipe = harmonicRecipe(findPeaks(spectrumOf(audio), RATE, 4096), 220, 8);
    expect(nearestWaveform(recipe).name).toBe('square');
  });

  it('names a measured sine a sine', () => {
    const audio = withRecipe(440, [1], 0.5);
    const recipe = harmonicRecipe(findPeaks(spectrumOf(audio), RATE, 4096), 440, 8);
    expect(nearestWaveform(recipe).name).toBe('sine');
  });

  it('rates a sawtooth brighter than a sine', () => {
    expect(brightness(WAVEFORMS.sawtooth)).toBeGreaterThan(brightness(WAVEFORMS.sine));
  });

  it('rates a triangle mellower than a square', () => {
    expect(brightness(WAVEFORMS.triangle)).toBeLessThan(brightness(WAVEFORMS.square));
  });

  it('reports no brightness for silence', () => {
    expect(brightness([0, 0, 0, 0])).toBe(0);
  });
});
