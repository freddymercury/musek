import { describe, expect, test } from 'vitest';
import { ARENA_ROUTE, greenIn, limitAt, nextLight, paceTo, phaseAt, phaseLeft, waveOffset } from './route';
import { CARS } from './cars';
import { createSim, step, total, type Sim } from './sim';
import { AUTO_START, autopilot } from './autopilot';
import { NO_SIGNAL_PENALTY, RED_LIGHT_PENALTY, SIGNAL_LEAD, grade } from './rules';

const route = ARENA_ROUTE;

describe('the route', () => {
  test('zones tile it end to end with no gap and no overlap', () => {
    expect(route.zones[0].from).toBe(0);
    expect(route.zones[route.zones.length - 1].to).toBe(route.length);
    for (let i = 1; i < route.zones.length; i++) expect(route.zones[i].from).toBe(route.zones[i - 1].to);
  });

  test('bands tile it too, so every metre knows how busy it is', () => {
    expect(route.bands[0].from).toBe(0);
    expect(route.bands[route.bands.length - 1].to).toBe(route.length);
    for (let i = 1; i < route.bands.length; i++) expect(route.bands[i].from).toBe(route.bands[i - 1].to);
  });

  test('every light and every closure is on the road', () => {
    for (const l of route.lights) {
      expect(l.s).toBeGreaterThan(0);
      expect(l.s).toBeLessThan(route.length);
    }
    for (const w of route.works) {
      expect(w.from).toBeGreaterThan(0);
      expect(w.to).toBeLessThan(route.length);
      expect(w.lane).toBeLessThan(route.lanes);
    }
  });

  test('a closure never blocks every lane at once', () => {
    for (let s = 0; s < route.length; s += 5) {
      const blocked = route.works.filter((w) => s >= w.from && s <= w.to).length;
      expect(blocked).toBeLessThan(route.lanes);
    }
  });

  test('the limit is posted everywhere', () => {
    for (let s = 0; s < route.length; s += 10) expect(limitAt(route, s)).toBeGreaterThan(0);
  });
});

describe('traffic lights', () => {
  const light = { id: 't', s: 100, green: 20, yellow: 3, red: 17, offset: 0 };

  test('cycle green, yellow, red and repeat', () => {
    expect(phaseAt(light, 0)).toBe('green');
    expect(phaseAt(light, 19.9)).toBe('green');
    expect(phaseAt(light, 21)).toBe('yellow');
    expect(phaseAt(light, 30)).toBe('red');
    expect(phaseAt(light, 40)).toBe('green');
    expect(phaseAt(light, -1)).toBe('red');
  });

  test('phaseLeft counts down the phase you are in', () => {
    expect(phaseLeft(light, 0)).toBeCloseTo(20, 6);
    expect(phaseLeft(light, 21)).toBeCloseTo(2, 6);
    expect(phaseLeft(light, 30)).toBeCloseTo(10, 6);
  });

  test('greenIn is zero on green and counts down to the next one otherwise', () => {
    expect(greenIn(light, 5)).toBe(0);
    expect(greenIn(light, 30)).toBeCloseTo(10, 6);
  });

  test('nextLight finds the one in front of you and nothing behind', () => {
    expect(nextLight(route, 0)?.s).toBe(route.lights[0].s);
    expect(nextLight(route, route.lights[0].s + 1, 9999)?.s).toBe(route.lights[1].s);
    expect(nextLight(route, route.length - 1)).toBeNull();
    // And it only looks as far as it is asked to.
    expect(nextLight(route, 0, 50)).toBeNull();
  });
});

/**
 * The mechanic that makes law-abiding the fast line rather than the virtuous
 * one. If these two tests ever disagree, speeding has quietly become optimal
 * and the whole design falls over.
 */
describe('the green wave', () => {
  test('hold the limit and every light is green when you get there', () => {
    for (const light of route.lights) {
      expect(phaseAt(light, paceTo(route.zones, light.s))).toBe('green');
    }
  });

  test('arrive early, because you hurried, and it is red', () => {
    for (const light of route.lights) {
      expect(phaseAt(light, paceTo(route.zones, light.s) - 10)).toBe('red');
    }
  });

  test('the wave tolerates arriving a few seconds late', () => {
    for (const light of route.lights) {
      expect(phaseAt(light, paceTo(route.zones, light.s) + 8)).toBe('green');
    }
  });

  test('waveOffset puts the arrival just inside the green', () => {
    expect(phaseAt({ id: 'w', s: 0, green: 20, yellow: 3, red: 17, offset: waveOffset(90, 40, 4) }, 90))
      .toBe('green');
  });
});

/**
 * A par nobody can reach without breaking the law is not a target, it is an
 * instruction to speed. The autopilot obeys every rule in the book, so if it
 * can get there, the brief is honest.
 */
describe('the drive is possible legally', () => {
  const drive = (carIndex: number, seed: number, dash = 0): Sim => {
    let sim = createSim(route, CARS[carIndex], seed);
    let mem = AUTO_START;
    const dt = 1 / 50;
    for (let i = 0; i < 40000 && !sim.finished && !sim.crashed; i++) {
      const next = autopilot(sim, mem, dt, dash);
      mem = next.mem;
      sim = step(sim, next.input, dt);
    }
    return sim;
  };

  const seeds = [1, 2, 3];

  test.each(CARS.map((c, i) => [c.name, i] as const))('%s arrives, clean, in traffic', (_name, i) => {
    for (const seed of seeds) {
      const sim = drive(i, seed);
      expect(sim.finished).toBe(true);
      expect(sim.crashed).toBeNull();
      expect(sim.violations).toEqual([]);
      // Worst car, worst traffic still medals: par is generous, not impossible.
      expect(grade({ crashed: false, total: total(sim), violations: [], par: route.par })).not.toBe('late');
    }
  });

  test.each(CARS.map((c, i) => [c.name, i] as const))('%s beats par on race day', (_name, i) => {
    const sim = drive(i, route.raceDay);
    expect(sim.violations).toEqual([]);
    expect(total(sim)).toBeLessThan(route.par);
  });

  /**
   * The other half of the bargain. If driving better cannot beat driving
   * patiently, the road has no game in it and every run is the traffic's time,
   * not the player's.
   */
  test('driving assertively -- still inside the law -- beats driving patiently', () => {
    const patient = drive(0, route.raceDay);
    const assertive = drive(0, route.raceDay, 1);
    expect(assertive.violations).toEqual([]);
    expect(assertive.crashed).toBeNull();
    expect(total(assertive)).toBeLessThan(total(patient) - 10);
  });
});

/**
 * No rule in the book can be worth breaking. Each of these compares the fine
 * against the most the violation could possibly save you on this route.
 */
describe('breaking the law never pays', () => {
  test('running a red costs more than the longest red could', () => {
    const longestWait = Math.max(...route.lights.map((l) => l.red + l.yellow));
    expect(RED_LIGHT_PENALTY).toBeGreaterThan(longestWait);
  });

  test('skipping the indicator costs more than the beat it saves', () => {
    expect(NO_SIGNAL_PENALTY).toBeGreaterThan(SIGNAL_LEAD);
  });
});
