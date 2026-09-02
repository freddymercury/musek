/**
 * A radix-2 Cooley-Tukey FFT.
 *
 * The browser has one inside AnalyserNode, but that one only works in real
 * time on a live graph. Owning the transform means re-analysing a recording
 * is a pure function from samples to spectra -- deterministic, testable, and
 * free to use whatever hop size we like rather than whatever rate the event
 * loop happened to deliver.
 */

/** Precomputed twiddle factors and bit-reversal, reused across frames. */
export interface FFTPlan {
  size: number;
  cos: Float32Array;
  sin: Float32Array;
  reverse: Uint32Array;
}

export function planFFT(size: number): FFTPlan {
  if ((size & (size - 1)) !== 0) {
    throw new Error(`FFT size must be a power of two, got ${size}`);
  }
  const half = size >> 1;
  const cos = new Float32Array(half);
  const sin = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / size);
    sin[i] = Math.sin((-2 * Math.PI * i) / size);
  }

  const bits = Math.log2(size);
  const reverse = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    reverse[i] = r;
  }

  return { size, cos, sin, reverse };
}

/**
 * Magnitude spectrum of a real signal. Returns size/2 bins, where bin k
 * corresponds to k * sampleRate / size Hz.
 */
export function magnitudeSpectrum(
  samples: Float32Array,
  plan: FFTPlan,
  out?: Float32Array,
): Float32Array {
  const { size, cos, sin, reverse } = plan;
  const re = new Float32Array(size);
  const im = new Float32Array(size);

  // Load in bit-reversed order, applying a Hann window. Without the window,
  // a note whose period does not divide the frame smears across every bin.
  for (let i = 0; i < size; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    re[reverse[i]] = (samples[i] ?? 0) * w;
  }

  for (let len = 2; len <= size; len <<= 1) {
    const half = len >> 1;
    const step = size / len;
    for (let i = 0; i < size; i += len) {
      for (let j = 0; j < half; j++) {
        const tw = j * step;
        const c = cos[tw];
        const s = sin[tw];
        const a = i + j;
        const b = a + half;
        const tr = re[b] * c - im[b] * s;
        const ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }

  const bins = size >> 1;
  const mags = out ?? new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    mags[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / bins;
  }
  return mags;
}
