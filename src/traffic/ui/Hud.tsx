import type { RefObject } from 'react';
import { kmh } from '../cars';
import { limitAt, nextLight, phaseAt, phaseLeft, zoneAt } from '../route';
import { TAILGATE_HEADWAY, headway, isSpeeding, totalPenalty } from '../rules';
import type { Input, Sim } from '../sim';
import { clock } from './format';


export function Hud({ sim, radarRef, onTap }: {
  sim: Sim;
  radarRef: RefObject<HTMLCanvasElement | null>;
  onTap: (input: Pick<Input, 'move' | 'toggle'>) => void;
}) {
  const { route, car, player } = sim;
  const limit = limitAt(route, player.s);
  const speeding = isSpeeding(player.v, limit);
  const penalty = totalPenalty(sim.violations);
  const spare = route.par - (sim.t + penalty);
  const zone = zoneAt(route, player.s);
  const light = nextLight(route, player.s, Math.max(car.lookahead, 160));
  const phase = light ? phaseAt(light, sim.t) : null;
  const close = headway(player.gap, player.v) < TAILGATE_HEADWAY;
  const progress = Math.min(1, player.s / route.length);
  const recent = sim.flashes.filter((f) => sim.t - f.at < 2.4);

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="panel clocks">
          <div className="clock-main mono">{clock(sim.t + penalty)}</div>
          <div className="clock-sub">
            <span className="dim mono">{clock(sim.t)} driving</span>
            <span className={penalty > 0 ? 'mono bad' : 'mono dim'}>+{penalty.toFixed(1)}s penalties</span>
          </div>
          <div className={spare < 0 ? 'curtain late' : 'curtain'}>
            {spare < 0 ? `${clock(-spare)} past the curtain` : `${clock(spare)} until the curtain`}
          </div>
        </div>

        <div className="toasts">
          {recent.map((f) => (
            <div key={f.id} className={`toast ${f.tone}`}>
              <strong>{f.text}</strong> <span>{f.detail}</span>
            </div>
          ))}
        </div>

        <div className="panel wayfind">
          <div className="zone">{zone.name}</div>
          <div className="bar"><span style={{ width: `${progress * 100}%` }} /></div>
          <div className="dim mono small">{Math.max(0, Math.round(route.length - player.s))} m to go</div>
        </div>
      </div>

      <div className="hud-side">
        <div className="panel radar">
          <div className="label">Road ahead · {car.lookahead}m</div>
          <canvas ref={radarRef} />
        </div>
        {light && phase && (
          <div className={`panel signal-ahead ${phase}`}>
            <span className="lamp" />
            <div>
              <div className="strong">{Math.round(light.s - player.s)} m</div>
              <div className="dim small">
                {phase === 'green' ? `green for ${phaseLeft(light, sim.t).toFixed(0)}s` : `green in ${phaseLeft(light, sim.t).toFixed(0)}s`}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="hud-bottom">
        <div className="panel dash">
          <div className={`speed mono ${speeding ? 'over' : ''}`}>
            {Math.round(kmh(player.v))}<span className="unit">km/h</span>
          </div>
          <div className="limit"><span>{Math.round(kmh(limit))}</span></div>
          <div className="indicators">
            <button
              className={`ind ${player.signal === -1 ? 'on' : ''}`}
              onClick={() => onTap({ move: 0, toggle: -1 })}
              aria-label="Left indicator"
            >◀</button>
            <button
              className={`ind ${player.signal === 1 ? 'on' : ''}`}
              onClick={() => onTap({ move: 0, toggle: 1 })}
              aria-label="Right indicator"
            >▶</button>
          </div>
          {close && <div className="warn-chip">Too close</div>}
          {speeding && <div className="warn-chip bad">Over the limit</div>}
        </div>
      </div>

      <div className="touch">
        <button onClick={() => onTap({ move: -1, toggle: 0 })}>Lane ◀</button>
        <button onClick={() => onTap({ move: 1, toggle: 0 })}>Lane ▶</button>
      </div>
    </div>
  );
}
