import { useCallback, useEffect, useRef, useState } from 'react';
import { decode, type Recording } from '../capture/recorder';
import { toSongTime } from '../analysis/timemap';
import {
  analysePartials, estimateFundamental, findPeaks, harmonicRecipe,
} from '../analysis/partials';
import { magnitudeSpectrum, planFFT } from '../analysis/fft';
import { resynthesize, spectralDistance } from '../audio/resynth';
import { audioContext } from '../audio/synth';
import { Timbre } from './Timbre';

interface Props {
  recording: Recording;
  /** Reports song position as the recording plays, for the timeline playhead. */
  onPosition: (songTime: number) => void;
  onReanalyse: () => void;
  onDiscard: () => void;
  analysing: boolean;
  /** Seek requests from the timeline, in song time. */
  seekToSong?: number | null;
}

function clock(seconds: number): string {
  if (!isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Plays back exactly what was captured. Useful on its own for checking what
 * the analyser was actually hearing, and it is the same audio the offline
 * pass re-reads.
 */
export function Playback({
  recording, onPosition, onReanalyse, onDiscard, analysing, seekToSong,
}: Props) {
  const ref = useRef<HTMLAudioElement>(null);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(recording.duration);

  const [rebuilding, setRebuilding] = useState(false);
  const [recipe, setRecipe] = useState<number[]>([]);
  const [fundamental, setFundamental] = useState(0);
  const [fidelity, setFidelity] = useState<number | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  /**
   * Rebuild the capture from its own partials and play that.
   *
   * A chord symbol keeps three pitch classes and throws away the sound; this
   * keeps the sound. Every sine it plays was measured from the recording, so
   * if it comes back recognisable, the analysis genuinely captured the tone.
   */
  const rebuild = useCallback(async () => {
    setRebuilding(true);
    try {
      const { samples, sampleRate } = await decode(recording);

      const frames = analysePartials(samples, sampleRate);
      const rebuilt = resynthesize(frames, sampleRate);
      setFidelity(spectralDistance(samples, rebuilt, sampleRate));

      // Describe the timbre from a frame partway in, past any silent start.
      const plan = planFFT(4096);
      const probe = new Float32Array(4096);
      probe.set(samples.subarray(
        Math.min(Math.floor(samples.length / 3), Math.max(0, samples.length - 4096)),
        Math.min(Math.floor(samples.length / 3) + 4096, samples.length),
      ));
      const peaks = findPeaks(magnitudeSpectrum(probe, plan), sampleRate, 4096);
      const f0 = estimateFundamental(peaks);
      setFundamental(f0);
      setRecipe(harmonicRecipe(peaks, f0, 8));

      const ac = audioContext();
      const buffer = ac.createBuffer(1, rebuilt.length, sampleRate);
      // set() rather than copyToChannel: the latter's typing rejects a
      // Float32Array that might be backed by a SharedArrayBuffer.
      buffer.getChannelData(0).set(rebuilt);

      sourceRef.current?.stop();
      const node = ac.createBufferSource();
      node.buffer = buffer;
      node.connect(ac.destination);
      node.start();
      sourceRef.current = node;
      node.onended = () => { sourceRef.current = null; };
    } finally {
      setRebuilding(false);
    }
  }, [recording]);

  const stopRebuild = useCallback(() => {
    sourceRef.current?.stop();
    sourceRef.current = null;
  }, []);

  useEffect(() => stopRebuild, [stopRebuild]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tick = () => {
      setAt(el.currentTime);
      onPosition(toSongTime(recording.timeMap, el.currentTime));
    };
    const meta = () => setLength(isFinite(el.duration) ? el.duration : recording.duration);
    el.addEventListener('timeupdate', tick);
    el.addEventListener('loadedmetadata', meta);
    el.addEventListener('durationchange', meta);
    return () => {
      el.removeEventListener('timeupdate', tick);
      el.removeEventListener('loadedmetadata', meta);
      el.removeEventListener('durationchange', meta);
    };
  }, [recording, onPosition]);

  // Clicking the timeline seeks the recording, when that moment was captured.
  useEffect(() => {
    if (seekToSong == null || !ref.current) return;
    ref.current.currentTime = seekToSong;
  }, [seekToSong]);

  return (
    <section className="playback">
      <div className="playback-head">
        <span className="label">capture</span>
        <span className="mono dim">{clock(at)} / {clock(length)}</span>
      </div>

      <audio ref={ref} src={recording.url} controls preload="metadata" />

      <div className="playback-actions">
        <button className="primary" onClick={onReanalyse} disabled={analysing}>
          {analysing ? 'Re-analysing…' : 'Re-analyse this capture'}
        </button>
        <a className="ghost button-link" href={recording.url} download="museek-capture.webm">
          Download
        </a>
        <button className="ghost" onClick={onDiscard}>Discard</button>
      </div>

      <div className="playback-actions">
        <button className="primary" onClick={() => void rebuild()} disabled={rebuilding}>
          {rebuilding ? 'Rebuilding…' : 'Rebuild the tone'}
        </button>
        <button className="ghost" onClick={stopRebuild}>Stop</button>
        {fidelity !== null && (
          <span className="mono dim">
            reconstruction {fidelity.toFixed(1)} dB
          </span>
        )}
      </div>

      <p className="hint">
        <strong>Rebuild the tone</strong> takes the capture apart into the sine
        waves it is made of and plays it back from those alone — no chord
        labels involved. It is the article's premise run in reverse, and it is
        how you tell whether the analysis heard the actual sound.
      </p>

      <Timbre recipe={recipe} fundamental={fundamental} />

      <p className="hint">
        The live pass runs on whatever frames the browser delivered. Re-analysing
        reads every sample at a finer hop, so it usually finds chords the live
        pass missed — and it merges into the timeline rather than replacing it.
      </p>
    </section>
  );
}
