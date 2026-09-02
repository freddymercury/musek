import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { arrange, arrangementLength, type Event } from '../analysis/arrange';
import type { Segment } from '../analysis/timeline';
import { play, type Transport } from '../audio/transport';

interface Props {
  segments: readonly Segment[];
  /** Song position, so playback can start where the timeline is parked. */
  position: number;
  onPosition: (seconds: number) => void;
}

function clock(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

/**
 * Plays the transcription back as chords. This is the quickest way to judge
 * whether an analysis is right: play it against the record and your ear
 * decides in about four bars.
 */
export function AnalysisPlayer({ segments, position, onPosition }: Props) {
  const [playing, setPlaying] = useState(false);
  const [bass, setBass] = useState(true);
  const [confident, setConfident] = useState(false);
  const transport = useRef<Transport | null>(null);

  const events: Event[] = useMemo(
    () => arrange(segments, {
      minConfidence: confident ? 0.6 : 0,
      minDuration: 0.15,
    }),
    [segments, confident],
  );

  const length = useMemo(() => arrangementLength(events), [events]);

  const stop = useCallback(() => {
    transport.current?.stop();
    transport.current = null;
    setPlaying(false);
  }, []);

  const start = useCallback((from: number) => {
    transport.current?.stop();
    setPlaying(true);
    transport.current = play(events, {
      from,
      bass,
      onPosition,
      onEnd: () => {
        transport.current = null;
        setPlaying(false);
      },
    });
  }, [events, bass, onPosition]);

  // Never leave oscillators running behind a closed panel.
  useEffect(() => stop, [stop]);
  useEffect(() => { if (playing) stop(); }, [events]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!events.length) return null;

  return (
    <section className="analysis-player">
      <div className="ap-head">
        <span className="label">play the analysis</span>
        <span className="mono dim">{events.length} chords · {clock(length)}</span>
      </div>

      <div className="ap-controls">
        {playing ? (
          <button className="stop" onClick={stop}>Stop</button>
        ) : (
          <>
            <button className="primary" onClick={() => start(0)}>Play from start</button>
            <button className="ghost" onClick={() => start(position)}>
              From {clock(position)}
            </button>
          </>
        )}

        <label className="check">
          <input type="checkbox" checked={bass} onChange={(e) => setBass(e.target.checked)} />
          bass
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={confident}
            onChange={(e) => setConfident(e.target.checked)}
          />
          confident chords only
        </label>
      </div>

      <p className="hint">
        Play this over the original and listen for where they part company.
        Chords the analyser was unsure of are played quieter, so a wrong chord
        that it already doubted will sound faint rather than confidently wrong.
      </p>
    </section>
  );
}
