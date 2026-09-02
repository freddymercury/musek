import {
  chromaFromSpectrum, compress, energy, estimateTuning, normalize, smooth, type Chroma,
} from '../analysis/chroma';
import { detectChord } from '../analysis/detect';
import { DEFAULT_GAMMA } from '../analysis/offline';
import { HOP, type Observation } from '../analysis/timeline';
import type { AudioSource } from './source';

/**
 * The listening loop. Impure by nature -- it owns an AnalyserNode and a timer
 * -- but it makes no decisions. It turns audio into Observations and hands
 * them to the pure timeline layer, which does all the actual reasoning.
 */

export const FFT_SIZE = 8192;

/** Frames of context before we believe a chord. ~0.4s at the default hop. */
const WINDOW = 4;

export interface ListenerOptions {
  /** Current position in the song, in seconds. */
  clock: () => number;
  onObservation: (obs: Observation) => void;
  onChroma?: (chroma: Chroma) => void;
  /** Below this total chroma energy we assume silence and stay quiet. */
  gate?: number;
  /**
   * Evidence an extra note needs before a seventh is believed. Lower it to
   * hear sevenths at the cost of some triad accuracy.
   */
  support?: number;
}

export interface Listener {
  stop(): void;
}

export function listen(source: AudioSource, opts: ListenerOptions): Listener {
  const { clock, onObservation, onChroma, gate = 0.001, support } = opts;

  const ac = new AudioContext();
  const node = ac.createMediaStreamSource(source.stream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.6;
  node.connect(analyser);
  // Deliberately not connected to destination: we are listening, not playing.

  const spectrumDb = new Float32Array(analyser.frequencyBinCount);
  const magnitudes = new Float32Array(analyser.frequencyBinCount);
  const recent: Chroma[] = [];

  /**
   * Running tuning estimate. Offline we take the median over the whole
   * recording, but live there is no whole recording yet, so votes accumulate
   * and the estimate settles within the first few seconds.
   */
  const tuningVotes: number[] = [];
  let tuning = 0;

  let stopped = false;

  const tick = () => {
    if (stopped) return;

    analyser.getFloatFrequencyData(spectrumDb);
    // getFloatFrequencyData reports dB; chroma weighting wants linear magnitude.
    for (let i = 0; i < spectrumDb.length; i++) {
      magnitudes[i] = spectrumDb[i] > -100 ? Math.pow(10, spectrumDb[i] / 20) : 0;
    }

    const raw = chromaFromSpectrum(magnitudes, ac.sampleRate, FFT_SIZE, tuning);
    onChroma?.(raw);

    if (energy(raw) > gate) {
      tuningVotes.push(estimateTuning(magnitudes, ac.sampleRate, FFT_SIZE));
      if (tuningVotes.length > 200) tuningVotes.shift();
      if (tuningVotes.length > 8) {
        tuning = [...tuningVotes].sort((a, b) => a - b)[tuningVotes.length >> 1];
      }

      // Compress after normalising, so gamma means the same at any volume.
      recent.push(compress(normalize(raw), DEFAULT_GAMMA));
      if (recent.length > WINDOW) recent.shift();
      const candidate = detectChord(smooth(recent), undefined, support);
      if (candidate) onObservation({ time: clock(), candidate });
    } else {
      recent.length = 0;
    }
  };

  const timer = setInterval(tick, HOP * 1000);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      node.disconnect();
      void ac.close();
    },
  };
}
