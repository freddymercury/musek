import { describe, expect, test } from 'vitest';
import { CARS, carById, fromKmh } from './cars';
import { ARENA_ROUTE, LANE_WIDTH, phaseAt, type Route } from './route';
import { NO_INPUT, createSim, laneX, step, total, type Input, type Sim } from './sim';
import { totalPenalty } from './rules';

const DT = 1 / 50;
const hatch = carById('hatchback');

/** A featureless straight, so a test can isolate one thing at a time. */
function plainRoute(extra: Partial<Route> = {}): Route {
  return {
    name: 'test', seat: 'A1', length: 1500, lanes: 3,
    zones: [{ from: 0, to: 1500, limit: fromKmh(50), name: 'Test' }],
    lights: [], works: [],
    bands: [{ from: 0, to: 1500, density: 1, dawdlers: 0 }],
    par: 100, raceDay: 1,
    ...extra,
  };
}

function empty(route = plainRoute(), car = hatch): Sim {
  return { ...createSim(route, car, 1), traffic: [] };
}

function run(sim: Sim, seconds: number, input: (sim: Sim, i: number) => Input = () => NO_INPUT): Sim {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames && !sim.crashed && !sim.finished; i++) sim = step(sim, input(sim, i), DT);
  return sim;
}

const throttle = (): Input => ({ ...NO_INPUT, throttle: true });
const brakes = (): Input => ({ ...NO_INPUT, brake: true });

describe('the car', () => {
  test('accelerates towards its top speed and never past it', () => {
    for (const car of CARS) {
      const sim = run(empty(plainRoute({ length: 99999 }), car), 120, throttle);
      expect(sim.player.v).toBeGreaterThan(car.topSpeed * 0.95);
      expect(sim.player.v).toBeLessThanOrEqual(car.topSpeed);
    }
  });

  test('a quicker car is ahead after ten seconds', () => {
    const quick = run(empty(plainRoute(), carById('coupe')), 10, throttle);
    const slow = run(empty(plainRoute(), carById('van')), 10, throttle);
    expect(quick.player.s).toBeGreaterThan(slow.player.s + 20);
  });

  test('brakes to a stop and does not reverse out of it', () => {
    let sim = run(empty(), 15, throttle);
    expect(sim.player.v).toBeGreaterThan(5);
    sim = run(sim, 10, brakes);
    expect(sim.player.v).toBe(0);
    const later = run(sim, 5, brakes);
    expect(later.player.s).toBeCloseTo(sim.player.s, 6);
  });

  test('coasting slows down', () => {
    const rolling = run(empty(), 10, throttle);
    const coasted = run(rolling, 6);
    expect(coasted.player.v).toBeLessThan(rolling.player.v);
  });
});

describe('steering', () => {
  test('a lane change takes the time the spec says and lands in the middle of the lane', () => {
    for (const car of CARS) {
      const start = empty(plainRoute(), car);
      const moving = step(start, { ...NO_INPUT, move: 1 }, DT);
      expect(moving.player.lane).toBe(1);
      expect(moving.player.target).toBe(2);

      const halfway = run(moving, car.laneChange / 2 - DT);
      expect(halfway.player.x).toBeGreaterThan(laneX(1));
      expect(halfway.player.x).toBeLessThan(laneX(2));

      const done = run(moving, car.laneChange);
      expect(done.player.lane).toBe(2);
      expect(done.player.x).toBeCloseTo(laneX(2), 6);
    }
  });

  test('the indicator cancels itself once you are across', () => {
    let sim = step(empty(), { ...NO_INPUT, toggle: 1 }, DT);
    expect(sim.player.signal).toBe(1);
    sim = run(sim, 1);
    sim = step(sim, { ...NO_INPUT, move: 1 }, DT);
    sim = run(sim, hatch.laneChange + 0.1);
    expect(sim.player.signal).toBe(0);
  });

  test('there is no lane to the left of the left lane', () => {
    let sim = empty();
    sim = run(step(sim, { ...NO_INPUT, move: -1 }, DT), 2);
    expect(sim.player.lane).toBe(0);
    sim = run(step(sim, { ...NO_INPUT, move: -1 }, DT), 2);
    expect(sim.player.lane).toBe(0);
    expect(sim.player.x).toBeCloseTo(laneX(0), 6);
  });

  test('a second lane change cannot interrupt the first', () => {
    let sim = step(empty(), { ...NO_INPUT, move: 1 }, DT);
    sim = step(sim, { ...NO_INPUT, move: 1 }, DT);
    expect(sim.player.target).toBe(2);
    sim = run(sim, 2);
    expect(sim.player.lane).toBe(2);
  });
});

describe('metal', () => {
  const parked = (s: number, lane: number) => ({
    id: 900, s, x: laneX(lane), lane, target: lane, cross: 0, v: 0,
    eagerness: 0, topSpeed: 0, desired: 0, length: 4.4, width: 1.8,
    colour: '#fff', signal: 0 as const, braking: false, cooldown: 999, fussiness: 1,
  });

  test('driving into the back of a stopped car is a collision', () => {
    const sim = run({ ...empty(), traffic: [parked(60, 1)] }, 20, throttle);
    expect(sim.crashed).not.toBeNull();
    expect(sim.crashed?.what).toBe('the car in front');
  });

  test('the same car in the next lane is not', () => {
    const sim = run({ ...empty(), traffic: [parked(60, 2)] }, 20, throttle);
    expect(sim.crashed).toBeNull();
    expect(sim.player.s).toBeGreaterThan(200);
  });

  test('steering into the side of one is', () => {
    let sim: Sim = { ...empty(), traffic: [parked(30, 2)] };
    sim = run(sim, 3, throttle);
    sim = step(sim, { ...NO_INPUT, move: 1, toggle: 1 }, DT);
    sim = run(sim, 6, throttle);
    expect(sim.crashed).not.toBeNull();
  });

  test('a closed lane is as solid as a car', () => {
    const route = plainRoute({ works: [{ id: 'w', lane: 1, from: 100, to: 200, reason: 'Test' }] });
    const sim = run(empty(route), 30, throttle);
    expect(sim.crashed?.what).toBe('the roadworks');
  });

  /**
   * The contract that makes "no collisions" fair to score: traffic will queue
   * behind a stopped player all day rather than drive into the back of them.
   */
  test('traffic will not hit you, even when you are the obstacle', () => {
    const base = createSim(ARENA_ROUTE, hatch, 4);
    // Park in a gap in the middle lane and simply stay there.
    const sim = run({
      ...base,
      player: { ...base.player, s: 600 },
      traffic: base.traffic.filter((v) => !(v.lane === 1 && Math.abs(v.s - 600) < 14)),
    }, 90);
    expect(sim.crashed).toBeNull();
    expect(sim.player.v).toBe(0);
  });
});

describe('the road', () => {
  test('traffic stops at a red light and goes again on green', () => {
    // Offset so the light is red at t = 0 and turns green at t = 20.
    const light = { id: 'x', s: 400, green: 20, yellow: 3, red: 20, offset: 23 };
    const route = plainRoute({ lights: [light] });
    expect(phaseAt(light, 0)).toBe('red');

    const base = createSim(route, hatch, 2);
    const car = { ...base.traffic[0], s: 340, lane: 1, target: 1, v: 10, desired: 13, eagerness: 1, topSpeed: 30 };
    let sim: Sim = { ...base, traffic: [car] };

    sim = run(sim, 15);
    expect(sim.traffic[0].v).toBeLessThan(0.5);
    expect(sim.traffic[0].s).toBeLessThan(light.s);
    expect(sim.traffic[0].s).toBeGreaterThan(light.s - 20);

    sim = run(sim, 12);
    expect(phaseAt(light, sim.t)).toBe('green');
    expect(sim.traffic[0].s).toBeGreaterThan(light.s);
  });

  test('the route ends when you reach the car park', () => {
    const sim = run(empty(plainRoute({ length: 200 })), 60, throttle);
    expect(sim.finished).toBe(true);
    expect(sim.player.s).toBeGreaterThanOrEqual(200);
  });

  test('a finished run is frozen', () => {
    const done = run(empty(plainRoute({ length: 200 })), 60, throttle);
    expect(run(done, 10, throttle)).toBe(done);
  });
});

describe('determinism', () => {
  test('the same seed and the same driving give the same run, to the metre', () => {
    const drive = (): Sim => run(createSim(ARENA_ROUTE, hatch, 77), 45, (_s, i) => ({
      ...NO_INPUT,
      throttle: i % 100 < 70,
      brake: i % 100 >= 90,
      move: i === 500 ? 1 : 0,
      toggle: i === 400 ? 1 : 0,
    }));
    const a = drive();
    const b = drive();
    expect(b.player.s).toBe(a.player.s);
    expect(b.player.v).toBe(a.player.v);
    expect(b.traffic.map((v) => v.s)).toEqual(a.traffic.map((v) => v.s));
    expect(totalPenalty(b.violations)).toBe(totalPenalty(a.violations));
    expect(total(b)).toBe(total(a));
  });

  test('a different seed gives a different road', () => {
    const a = createSim(ARENA_ROUTE, hatch, 1);
    const b = createSim(ARENA_ROUTE, hatch, 2);
    expect(b.traffic.map((v) => v.s)).not.toEqual(a.traffic.map((v) => v.s));
  });

  test('stepping does not mutate the sim it was given', () => {
    const before = createSim(ARENA_ROUTE, hatch, 5);
    const snapshot = JSON.stringify(before);
    step(before, { throttle: true, brake: false, move: 1, toggle: 0 }, DT);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('lanes', () => {
  test('are a lane width apart', () => {
    expect(laneX(1) - laneX(0)).toBe(LANE_WIDTH);
  });
});
