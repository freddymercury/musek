import { useEffect, useRef, useState } from 'react';
import { CARS, kmh, type CarSpec } from '../cars';
import { ARENA_ROUTE } from '../route';
import { createSim, step, type Sim } from '../sim';
import { AUTO_START, autopilot } from '../autopilot';
import { drawChase } from '../chase';
import { clock, minutes } from './format';

const STEP = 1 / 60;

/** The road running behind the menu, driven by the autopilot. */
function Attract({ car }: { car: CarSpec }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let sim: Sim = createSim(ARENA_ROUTE, car, 12);
    let mem = AUTO_START;
    let raf = 0;
    let last = performance.now();
    let debt = 0;
    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      debt += Math.min(0.2, (now - last) / 1000);
      last = now;
      while (debt >= STEP) {
        const next = autopilot(sim, mem, STEP, 0.6);
        mem = next.mem;
        sim = step(sim, next.input, STEP);
        debt -= STEP;
        if (sim.finished || sim.crashed) {
          sim = createSim(ARENA_ROUTE, car, 12 + Math.floor(Math.random() * 900));
          mem = AUTO_START;
        }
      }
      const canvas = ref.current;
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
      if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawChase(ctx, sim, w, h);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [car]);

  return <canvas ref={ref} className="attract" />;
}

const best = (car: CarSpec): number => car.topSpeed;

function Stat({ label, value, of, detail }: { label: string; value: number; of: number; detail: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-bar"><span style={{ width: `${Math.round((value / of) * 100)}%` }} /></span>
      <span className="stat-detail mono dim">{detail}</span>
    </div>
  );
}

export function Garage({ bests, onDrive }: {
  bests: Record<string, number>;
  onDrive: (car: CarSpec, shuffle: boolean) => void;
}) {
  const [picked, setPicked] = useState(CARS[0]);
  const [shuffle, setShuffle] = useState(false);
  const top = Math.max(...CARS.map(best));
  const quick = Math.max(...CARS.map((c) => c.accel));
  const stop = Math.max(...CARS.map((c) => c.brake));
  const nimble = Math.max(...CARS.map((c) => 1 / c.laneChange));
  const sight = Math.max(...CARS.map((c) => c.lookahead));

  return (
    <div className="garage">
      <header>
        <h1>Sit <span className="e">in</span> Traffic</h1>
        <p className="tagline">
          {ARENA_ROUTE.name} — {ARENA_ROUTE.seat}. Doors in {minutes(ARENA_ROUTE.par)}.
          Get there first, get there legally, and do not hit anything.
        </p>
      </header>

      <div className="garage-body">
        <div className="picker">
          {CARS.map((car) => (
            <button
              key={car.id}
              className={`card ${car.id === picked.id ? 'on' : ''}`}
              onClick={() => setPicked(car)}
            >
              <span className="chip" style={{ background: car.body }} />
              <span className="card-name">{car.name}</span>
              <span className="mono dim small">
                {bests[car.id] ? `best ${clock(bests[car.id])}` : 'not yet driven'}
              </span>
            </button>
          ))}
        </div>

        <div className="detail">
          <Attract car={picked} />
          <div className="detail-text">
            <h2>{picked.name}</h2>
            <p className="dim">{picked.blurb}</p>
            <Stat label="Top speed" value={best(picked)} of={top} detail={`${Math.round(kmh(picked.topSpeed))} km/h`} />
            <Stat label="Acceleration" value={picked.accel} of={quick} detail={`${picked.accel.toFixed(1)} m/s²`} />
            <Stat label="Brakes" value={picked.brake} of={stop} detail={`${picked.brake.toFixed(1)} m/s²`} />
            <Stat label="Agility" value={1 / picked.laneChange} of={nimble} detail={`${picked.laneChange.toFixed(2)}s a lane`} />
            <Stat label="Sight line" value={picked.lookahead} of={sight} detail={`${picked.lookahead} m`} />
          </div>
        </div>
      </div>

      <div className="start">
        <button className="primary big" onClick={() => onDrive(picked, shuffle)}>
          Drive the {picked.name.split(' ').slice(-1)[0].toLowerCase()}
        </button>
        <label className="toggle">
          <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />
          Shuffle the traffic
          <span className="dim small">
            {shuffle ? 'A road nobody has driven. Par is still par.' : 'Race-day traffic: the same jam for everyone.'}
          </span>
        </label>
      </div>

      <div className="legend">
        <div><kbd>↑</kbd><kbd>W</kbd> throttle</div>
        <div><kbd>↓</kbd><kbd>S</kbd> brake</div>
        <div><kbd>←</kbd><kbd>→</kbd> change lane</div>
        <div><kbd>Q</kbd><kbd>E</kbd> indicators</div>
        <div><kbd>V</kbd> chase / map view</div>
        <div><kbd>Esc</kbd> pause</div>
      </div>

      <p className="footnote dim">
        Indicate <em>before</em> you move across — four tenths of a second is what the law
        wants and what the game checks. Lights are timed as a green wave: hold the limit and
        they open for you, hurry and you will sit at the next one wondering why.
      </p>
    </div>
  );
}
