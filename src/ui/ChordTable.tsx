import { useMemo, useState } from 'react';
import { CHORD_QUALITIES, chord, type ChordQuality } from '../theory/chords';
import { pitchClassName } from '../theory/pitch';
import { playChord, playArpeggio } from '../audio/synth';
import { fitsKey } from '../analysis/detect';
import { histogram, type Segment } from '../analysis/timeline';

type SortKey = 'symbol' | 'count' | 'seconds';

interface Props {
  segments: readonly Segment[];
  tonic: number | null;
  mode: 'major' | 'minor';
}

/** Every chord the song used, sortable, with each one playable. */
export function ChordTable({ segments, tonic, mode }: Props) {
  const [sort, setSort] = useState<SortKey>('seconds');
  const [desc, setDesc] = useState(true);

  const rows = useMemo(() => {
    const counts = histogram(segments);
    const bySymbol = new Map(segments.map((s) => [s.symbol, s]));
    return counts.map((c) => {
      const seg = bySymbol.get(c.symbol)!;
      return { ...c, root: seg.root, quality: seg.quality as ChordQuality };
    });
  }, [segments]);

  const sorted = useMemo(() => {
    const dir = desc ? -1 : 1;
    return [...rows].sort((a, b) => {
      if (sort === 'symbol') return a.symbol.localeCompare(b.symbol) * dir;
      return (a[sort] - b[sort]) * dir;
    });
  }, [rows, sort, desc]);

  const click = (key: SortKey) => {
    if (key === sort) setDesc(!desc);
    else { setSort(key); setDesc(true); }
  };

  if (!rows.length) return <p className="empty">No chords yet. Start listening.</p>;

  return (
    <table className="chord-table">
      <thead>
        <tr>
          <th onClick={() => click('symbol')}>Chord</th>
          <th>Notes</th>
          <th onClick={() => click('count')}>Times</th>
          <th onClick={() => click('seconds')}>Seconds</th>
          <th>In key</th>
          <th>Play</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => {
          const c = chord(60 + r.root, r.quality);
          const diatonic = tonic === null ? null : fitsKey(r.root, tonic, mode);
          return (
            <tr key={r.symbol}>
              <td className="mono strong">{r.symbol}</td>
              <td className="mono dim">
                {CHORD_QUALITIES[r.quality].intervals
                  .map((iv) => pitchClassName((r.root + iv) % 12)).join(' ')}
              </td>
              <td>{r.count}</td>
              <td>{r.seconds.toFixed(1)}</td>
              <td>
                {diatonic === null ? '—'
                  : diatonic ? <span className="tag in">diatonic</span>
                  : <span className="tag out">borrowed</span>}
              </td>
              <td className="actions">
                <button onClick={() => playChord(c.notes)}>▶</button>
                <button onClick={() => playArpeggio(c.notes)} title="Arpeggio">⋮</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
