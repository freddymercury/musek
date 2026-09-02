import { useEffect, useRef, useState } from 'react';
import type { Recording } from '../capture/recorder';
import { toSongTime } from '../analysis/timemap';

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

      <p className="hint">
        The live pass runs on whatever frames the browser delivered. Re-analysing
        reads every sample at a finer hop, so it usually finds chords the live
        pass missed — and it merges into the timeline rather than replacing it.
      </p>
    </section>
  );
}
