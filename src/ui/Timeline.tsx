import { chord, type ChordQuality } from '../theory/chords';
import { playChord } from '../audio/synth';
import { chordAt, type Segment } from '../analysis/timeline';

interface Props {
  segments: readonly Segment[];
  duration: number;
  position: number;
  onSeek: (seconds: number) => void;
}

/** The song as a strip of chords. Click one to hear it and jump there. */
export function Timeline({ segments, duration, position, onSeek }: Props) {
  const span = duration || Math.max(1, ...segments.map((s) => s.end));
  const current = chordAt(segments, position);

  return (
    <div className="timeline">
      <div className="track">
        {segments.map((s, i) => (
          <button
            key={`${s.start}-${i}`}
            className={`seg ${current === s ? 'current' : ''}`}
            style={{
              left: `${(s.start / span) * 100}%`,
              width: `${Math.max(0.3, ((s.end - s.start) / span) * 100)}%`,
              opacity: 0.35 + Math.min(0.65, s.confidence),
            }}
            title={`${s.symbol} — ${s.start.toFixed(1)}s, confidence ${s.confidence.toFixed(2)}, ${s.support} frames`}
            onClick={() => {
              onSeek(s.start);
              playChord(chord(60 + s.root, s.quality as ChordQuality).notes);
            }}
          >
            <span>{s.symbol}</span>
          </button>
        ))}
        <div className="playhead" style={{ left: `${(position / span) * 100}%` }} />
      </div>
    </div>
  );
}
