import { useCallback, useEffect, useRef, useState } from 'react';
import type { CarSpec } from '../cars';
import { ARENA_ROUTE } from '../route';
import { NO_INPUT, createSim, step, type Input, type Sim } from '../sim';
import { draw, drawRadar } from '../render';
import { Hud } from './Hud';

/**
 * Physics runs on a fixed 1/60 step regardless of frame rate, and the renderer
 * draws whatever the last step produced. A variable `dt` would make the game
 * behave differently on a 144 Hz monitor -- and would make the same drive score
 * differently depending on whose laptop it ran on, which for a game about
 * shaving seconds is not a small thing.
 */
const STEP = 1 / 60;

const HELD: Record<string, 'throttle' | 'brake'> = {
  ArrowUp: 'throttle', KeyW: 'throttle',
  ArrowDown: 'brake', KeyS: 'brake', Space: 'brake',
};

export function Game({ car, seed, onFinish }: {
  car: CarSpec;
  seed: number;
  onFinish: (sim: Sim) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const radarRef = useRef<HTMLCanvasElement>(null);
  const [shown, setShown] = useState<Sim>(() => createSim(ARENA_ROUTE, car, seed));
  const simRef = useRef<Sim>(shown);
  const held = useRef(new Set<string>());
  const queued = useRef<Array<Pick<Input, 'move' | 'toggle'>>>([]);
  const done = useRef(false);
  const [paused, setPaused] = useState(false);
  const [lights, setLights] = useState(3);

  const pauseToggle = useCallback(() => setPaused((p) => !p), []);

  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      const code = e.code;
      if (code in HELD || code.startsWith('Arrow') || code === 'Space') e.preventDefault();
      if (code in HELD) held.current.add(code);
      else if (code === 'ArrowLeft' || code === 'KeyA') queued.current.push({ move: -1, toggle: 0 });
      else if (code === 'ArrowRight' || code === 'KeyD') queued.current.push({ move: 1, toggle: 0 });
      else if (code === 'KeyQ') queued.current.push({ move: 0, toggle: -1 });
      else if (code === 'KeyE') queued.current.push({ move: 0, toggle: 1 });
      else if (code === 'Escape' || code === 'KeyP') pauseToggle();
    };
    const up = (e: KeyboardEvent): void => { held.current.delete(e.code); };
    const blur = (): void => { held.current.clear(); setPaused(true); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [pauseToggle]);

  // The lights on the gantry: three, two, one, go.
  useEffect(() => {
    if (lights <= 0) return;
    const id = setTimeout(() => setLights((n) => n - 1), 900);
    return () => clearTimeout(id);
  }, [lights]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let debt = 0;

    const fit = (canvas: HTMLCanvasElement): [number, number] => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      return [w, h];
    };

    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      const elapsed = Math.min(0.25, (now - last) / 1000);
      last = now;

      const sim = simRef.current;
      const running = !paused && lights <= 0 && !sim.crashed && !sim.finished;
      if (running) {
        debt += elapsed;
        let next = sim;
        while (debt >= STEP) {
          // Taps (a lane change, an indicator) are consumed by exactly one
          // physics step, so a key press is never eaten or acted on twice.
          const tap = queued.current.shift();
          next = step(next, {
            throttle: [...held.current].some((k) => HELD[k] === 'throttle'),
            brake: [...held.current].some((k) => HELD[k] === 'brake'),
            move: tap?.move ?? 0,
            toggle: tap?.toggle ?? 0,
          }, STEP);
          debt -= STEP;
          if (next.crashed || next.finished) break;
        }
        simRef.current = next;
        setShown(next);
        if ((next.crashed || next.finished) && !done.current) {
          done.current = true;
          onFinish(next);
        }
      } else {
        debt = 0;
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const [w, h] = fit(canvas);
        const ctx = canvas.getContext('2d');
        if (ctx) draw(ctx, simRef.current, w, h);
      }
      const radar = radarRef.current;
      if (radar) {
        const [w, h] = fit(radar);
        const ctx = radar.getContext('2d');
        if (ctx) drawRadar(ctx, simRef.current, w, h);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [paused, lights, onFinish]);

  const tap = useCallback((input: Pick<Input, 'move' | 'toggle'>) => {
    queued.current.push({ ...NO_INPUT, ...input });
  }, []);

  return (
    <div className="drive">
      <canvas ref={canvasRef} className="road" />
      <Hud sim={shown} radarRef={radarRef} onTap={tap} />
      {lights > 0 && (
        <div className="overlay">
          <div className="count">{lights}</div>
          <p className="dim">Doors close in {Math.round(ARENA_ROUTE.par / 60)} minutes.</p>
        </div>
      )}
      {paused && lights <= 0 && (
        <div className="overlay">
          <div className="count small">Paused</div>
          <button className="primary" onClick={pauseToggle}>Back to the road</button>
        </div>
      )}
    </div>
  );
}
