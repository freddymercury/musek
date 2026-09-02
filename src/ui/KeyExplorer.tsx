import { useState } from 'react';
import { diatonicChords, progression, tension } from '../theory/chords';
import { PITCH_CLASSES, pitchClassName } from '../theory/pitch';
import { scale, SCALE_STEPS, type ScaleName } from '../theory/scales';
import { playChord, playArpeggio, playScale, playProgression } from '../audio/synth';
import { Keyboard } from './Keyboard';

const FAMOUS: Array<[string, string[]]> = [
  ['Pop (I–V–vi–IV)', ['I', 'V', 'vi', 'IV']],
  ['Doo-wop (I–vi–IV–V)', ['I', 'vi', 'IV', 'V']],
  ['Sad (vi–IV–I–V)', ['vi', 'IV', 'I', 'V']],
  ['Blues turnaround (I–IV–V–I)', ['I', 'IV', 'V', 'I']],
  ['Andalusian (vi–V–IV–III)', ['vi', 'V', 'IV', 'III']],
];

interface Props {
  suggestedTonic?: number | null;
  suggestedScale?: ScaleName;
}

/**
 * The playground half of the app: pick a key, see what chords live in it,
 * and hear any of them. Seeded from whatever the song turned out to be in.
 */
export function KeyExplorer({ suggestedTonic, suggestedScale }: Props) {
  const [tonic, setTonic] = useState(suggestedTonic ?? 0);
  const [scaleName, setScaleName] = useState<ScaleName>(suggestedScale ?? 'major');
  const [sevenths, setSevenths] = useState(false);
  const [hovered, setHovered] = useState<number[] | null>(null);

  const root = 60 + tonic;
  const notes = scale(root, scaleName);
  const heptatonic = notes.length === 7;
  const chords = heptatonic ? diatonicChords(root, scaleName, sevenths) : [];

  return (
    <section className="explorer">
      <div className="controls">
        <label>
          Key
          <select value={tonic} onChange={(e) => setTonic(Number(e.target.value))}>
            {PITCH_CLASSES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
        </label>
        <label>
          Scale
          <select value={scaleName} onChange={(e) => setScaleName(e.target.value as ScaleName)}>
            {Object.keys(SCALE_STEPS).map((n) => (
              <option key={n} value={n}>{n.replace(/([A-Z])/g, ' $1').toLowerCase()}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={sevenths} onChange={(e) => setSevenths(e.target.checked)} />
          sevenths
        </label>
        <button className="ghost" onClick={() => playScale(notes)}>▶ scale</button>
      </div>

      <Keyboard
        active={hovered ?? []}
        inScale={notes}
        octaves={2}
      />

      <div className="steps mono dim">
        steps {SCALE_STEPS[scaleName].join('–')} · {notes.map((n) => pitchClassName(n % 12)).join(' ')}
      </div>

      {heptatonic ? (
        <>
          <div className="chord-grid">
            {chords.map((c) => (
              <button
                key={c.roman}
                className={`chord-card fn-${c.function}`}
                onMouseEnter={() => setHovered(c.notes)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => playChord(c.notes)}
                onDoubleClick={() => playArpeggio(c.notes)}
              >
                <span className="roman">{c.roman}</span>
                <span className="sym">{c.symbol}</span>
                <span className="fn">{c.function}</span>
                <span className="tension" title={`tension ${tension(c.notes)}`}>
                  {'•'.repeat(Math.min(5, Math.round(tension(c.notes) / 2)))}
                </span>
              </button>
            ))}
          </div>

          <div className="progressions">
            <h4>Progressions in {pitchClassName(tonic)}</h4>
            {FAMOUS.map(([label, numerals]) => (
              <button
                key={label}
                className="ghost"
                onClick={() => playProgression(progression(root, numerals, scaleName).map((c) => c.notes))}
              >
                ▶ {label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="empty">
          {scaleName.replace(/([A-Z])/g, ' $1')} has {notes.length} notes, so it has no
          seven diatonic triads. Play the scale, or switch to major or minor.
        </p>
      )}
    </section>
  );
}
