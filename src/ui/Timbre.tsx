import { brightness, nearestWaveform, WAVEFORMS } from '../analysis/partials';

interface Props {
  /** Measured harmonic recipe of the capture. */
  recipe: number[];
  fundamental: number;
}

/**
 * The measured timbre, shown as what it is: a recipe of overtones.
 *
 * This is the article's claim made visible -- a sine, triangle, square and
 * sawtooth are the same note and different sounds purely because of these
 * numbers, so a recording's own numbers say what it sounds like.
 */
export function Timbre({ recipe, fundamental }: Props) {
  if (!recipe.length || fundamental <= 0) return null;

  const match = nearestWaveform(recipe);
  const bright = brightness(recipe);
  const ideal = WAVEFORMS[match.name];

  return (
    <section className="timbre">
      <div className="ap-head">
        <span className="label">timbre</span>
        <span className="mono dim">
          closest to a {match.name} · {Math.round(bright * 100)}% overtones
        </span>
      </div>

      <div className="recipe">
        {recipe.map((amp, i) => (
          <div key={i} className="recipe-col" title={`Harmonic ${i + 1}: ${amp.toFixed(2)}`}>
            <div className="recipe-stack">
              <div className="recipe-ideal" style={{ height: `${(ideal[i] ?? 0) * 100}%` }} />
              <div className="recipe-bar" style={{ height: `${Math.max(1, amp * 100)}%` }} />
            </div>
            <span>{i + 1}</span>
          </div>
        ))}
      </div>

      <p className="hint">
        Bars are the overtones actually measured; the faint outline is a pure{' '}
        {match.name} for comparison. Harmonic 1 is the note you hear as the
        pitch, at {Math.round(fundamental)}Hz — everything to its right is what
        makes it sound like an instrument rather than a test tone.
      </p>
    </section>
  );
}
