import { LABELS, MEDAL_TEXT, grade, totalPenalty, type Violation } from '../rules';
import { total, type Sim } from '../sim';
import { clock } from './format';

/** One line per kind: a run with nine speeding stretches is one habit, not nine. */
function summarise(violations: Violation[]): Array<{ kind: Violation['kind']; count: number; seconds: number; note: string }> {
  const rows = new Map<Violation['kind'], { kind: Violation['kind']; count: number; seconds: number; note: string }>();
  for (const v of violations) {
    const row = rows.get(v.kind) ?? { kind: v.kind, count: 0, seconds: 0, note: v.note };
    row.count += 1;
    row.seconds += v.seconds;
    rows.set(v.kind, row);
  }
  return [...rows.values()].sort((a, b) => b.seconds - a.seconds);
}

export function Results({ sim, best, onAgain, onShuffle, onGarage }: {
  sim: Sim;
  best: number | undefined;
  onAgain: () => void;
  onShuffle: () => void;
  onGarage: () => void;
}) {
  const penalty = totalPenalty(sim.violations);
  const score = total(sim);
  const medal = grade({ crashed: sim.crashed !== null, total: score, violations: sim.violations, par: sim.route.par });
  const spare = sim.route.par - score;

  return (
    <div className="results">
      <div className={`verdict ${medal}`}>
        <h2>{MEDAL_TEXT[medal]}</h2>
        {sim.crashed ? (
          <p className="dim">
            You hit {sim.crashed.what} {Math.round(sim.crashed.s)} m in, with{' '}
            {Math.round(sim.route.length - sim.crashed.s)} m still to go. The curtain went up without you.
          </p>
        ) : (
          <p className="dim">
            {spare >= 0
              ? `You made it with ${clock(spare)} to spare, in the ${sim.car.name.toLowerCase()}.`
              : `You were ${clock(-spare)} late, in the ${sim.car.name.toLowerCase()}.`}
          </p>
        )}
      </div>

      {!sim.crashed && (
        <div className="tally">
          <div><span className="dim">Driving</span><span className="mono">{clock(sim.t)}</span></div>
          <div><span className="dim">Penalties</span><span className="mono bad">+{penalty.toFixed(1)}s</span></div>
          <div className="sum"><span>Total</span><span className="mono">{clock(score)}</span></div>
          <div><span className="dim">Par</span><span className="mono dim">{clock(sim.route.par)}</span></div>
          {best !== undefined && (
            <div>
              <span className="dim">Your best</span>
              <span className="mono dim">{clock(best)}{score < best ? ' — beaten' : ''}</span>
            </div>
          )}
        </div>
      )}

      <div className="tickets">
        <h3>{sim.violations.length ? 'What the law noticed' : 'A clean run — nothing to report'}</h3>
        {sim.violations.length > 0 && (
          <ul>
            {summarise(sim.violations).map((row) => (
              <li key={row.kind}>
                <span className="strong">{LABELS[row.kind]}</span>
                <span className="dim"> — {row.count > 1 ? `${row.count} times` : row.note.toLowerCase()}</span>
                <span className="mono bad"> +{row.seconds.toFixed(1)}s</span>
              </li>
            ))}
          </ul>
        )}
        {!sim.violations.length && !sim.crashed && (
          <p className="dim">
            No speeding, no red lights, no unsignalled lane changes, nobody's bumper crowded.
            That is the hard half of the brief.
          </p>
        )}
      </div>

      <div className="again">
        <button className="primary" onClick={onAgain}>Same traffic, again</button>
        <button onClick={onShuffle}>New traffic</button>
        <button className="ghost" onClick={onGarage}>Back to the garage</button>
      </div>
    </div>
  );
}
