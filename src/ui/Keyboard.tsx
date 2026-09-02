import { pitchClass, pitchClassName } from '../theory/pitch';
import { playNote } from '../audio/synth';

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const BLACK_AFTER = new Set([0, 2, 5, 7, 9]);

interface Props {
  /** Pitch classes to highlight, e.g. the notes of the current chord. */
  active?: number[];
  /** Pitch classes in the current key, shown more faintly. */
  inScale?: number[];
  octaves?: number;
  baseOctave?: number;
}

/** A playable keyboard. Clicking a key sounds it, which is the whole point. */
export function Keyboard({ active = [], inScale = [], octaves = 2, baseOctave = 4 }: Props) {
  const activeSet = new Set(active.map(pitchClass));
  const scaleSet = new Set(inScale.map(pitchClass));

  const whites: Array<{ midi: number; pc: number }> = [];
  for (let o = 0; o < octaves; o++) {
    for (const pc of WHITE) whites.push({ midi: (baseOctave + 1 + o) * 12 + pc, pc });
  }

  return (
    <div className="keyboard">
      {whites.map(({ midi, pc }, i) => (
        <div key={midi} className="key-slot">
          <button
            className={`key white ${activeSet.has(pc) ? 'active' : ''} ${scaleSet.has(pc) ? 'in-scale' : ''}`}
            onClick={() => playNote(midi)}
            title={pitchClassName(pc)}
          >
            <span>{pitchClassName(pc)}</span>
          </button>
          {BLACK_AFTER.has(pc) && i < whites.length - 1 && (
            <button
              className={`key black ${activeSet.has(pitchClass(pc + 1)) ? 'active' : ''} ${
                scaleSet.has(pitchClass(pc + 1)) ? 'in-scale' : ''
              }`}
              onClick={(e) => { e.stopPropagation(); playNote(midi + 1); }}
              title={pitchClassName(pc + 1)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
