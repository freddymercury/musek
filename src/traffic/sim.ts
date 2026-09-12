/**
 * The road, simulated.
 *
 * One pure function -- `step(sim, input, dt)` -- takes a world and returns the
 * next one. Nothing in here touches a canvas, a key or a clock, which is why
 * the same code can be driven by a player at 60 Hz, by the autopilot in a test
 * at 20 Hz, and by the attract loop on the menu.
 *
 * The traffic is not scripted. Every car runs the Intelligent Driver Model --
 * accelerate towards your desired speed, back off as the gap to the car ahead
 * closes -- and jams come out of that on their own: one van that wants to do
 * 34 km/h in a 50 zone grows a queue behind it with nobody deciding there
 * should be a queue. That is the whole point of the genre. A scripted jam is
 * an obstacle; an emergent one is traffic, and it rewards reading the road.
 *
 *     dv/dt = a[1 - (v/v0)^4 - (want/gap)^2],  want = s0 + vT + v.dv / 2sqrt(ab)
 *
 * The one thing the model is deliberately not allowed to do is hit you. AI
 * cars treat the player as an obstacle in both the lane it is in and the lane
 * it is moving to, and refuse to merge anywhere near it. Every collision in
 * this game is therefore yours, which is the only way "no collisions" is a
 * fair thing to score somebody on.
 */
import type { CarSpec } from './cars';
import type { Route, Works } from './route';
import { LANE_WIDTH, limitAt, phaseAt } from './route';
import type { Violation } from './rules';
import {
  SIGNAL_LEAD, TAILGATE_GRACE, TAILGATE_HEADWAY, TAILGATE_MIN_SPEED, TAILGATE_RATE,
  NO_SIGNAL_PENALTY, RED_LIGHT_PENALTY, accrue, closeOut, headway, isSpeeding, once,
  speedingRate, totalPenalty,
} from './rules';

/** IDM parameters for the ambient traffic -- an unhurried, competent driver. */
const IDM_ACCEL = 1.9;
const IDM_BRAKE = 2.6;
/** Standstill gap, metres. */
const GAP_MIN = 2.2;
/** Desired time headway, seconds. */
const GAP_TIME = 1.25;
/** Hardest an AI car will ever brake, m/s^2. */
const PANIC = 7.5;
/** Above this deceleration a car will not stop for a light it is already on top of. */
const STOPPABLE = 4.5;

const PLAYER_ID = -1;
const WORKS_ID = -2;
const LIGHT_ID = -3;

export interface Vehicle {
  id: number;
  /** Centre of the car, metres along the route. */
  s: number;
  /** Lateral position, metres. Lane i is centred on i * LANE_WIDTH. */
  x: number;
  lane: number;
  /** Lane being moved into; equal to `lane` when settled. */
  target: number;
  /** Fraction of the lane change completed. */
  cross: number;
  v: number;
  /** Fraction of the posted limit this driver aims for. */
  eagerness: number;
  /** What the vehicle itself will do, m/s. Lorries cap out well under a motorway limit. */
  topSpeed: number;
  /** Speed this driver currently wants -- eagerness against the limit here, capped. */
  desired: number;
  length: number;
  width: number;
  colour: string;
  signal: -1 | 0 | 1;
  braking: boolean;
  /** Seconds before this driver will consider another lane change. */
  cooldown: number;
  /** How much better the next lane has to look before this driver moves. */
  fussiness: number;
}

export interface PlayerState {
  s: number;
  x: number;
  v: number;
  lane: number;
  target: number;
  cross: number;
  signal: -1 | 0 | 1;
  /** Seconds the current indicator has been on. */
  signalFor: number;
  braking: boolean;
  /** Bumper-to-bumper gap to whatever is ahead, metres (Infinity if clear). */
  gap: number;
}

export interface Flash {
  id: number;
  text: string;
  detail: string;
  tone: 'bad' | 'info' | 'good';
  at: number;
}

export interface Crash {
  /** What you hit. */
  what: string;
  s: number;
  t: number;
}

export interface Sim {
  t: number;
  route: Route;
  car: CarSpec;
  player: PlayerState;
  traffic: Vehicle[];
  violations: Violation[];
  crashed: Crash | null;
  finished: boolean;
  /** Seconds spent inside the current tailgating stretch. */
  tailFor: number;
  /** Lights already paid for, so one red is one fine. */
  ranReds: string[];
  flashes: Flash[];
  rng: number;
  nextFlash: number;
}

export interface Input {
  throttle: boolean;
  brake: boolean;
  /** One-shot: -1 move a lane left, +1 right. */
  move: -1 | 0 | 1;
  /** One-shot indicator toggle. */
  toggle: -1 | 0 | 1;
}

export const NO_INPUT: Input = { throttle: false, brake: false, move: 0, toggle: 0 };

export const laneX = (lane: number): number => lane * LANE_WIDTH;

/** Where you join the queue. */
export const START_LANE = 1;

/** Deterministic, so a seed is a road: the same traffic every time you retry. */
function mulberry(state: number): [number, number] {
  let a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

/** Stable small hash, for choices that must be the same every run of a seed. */
function mix(a: number, b: number): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x165667b1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const TRAFFIC_COLOURS = [
  '#8e9bb3', '#c9cfda', '#6d7a91', '#a8b4c8', '#7f8aa0',
  '#9db3a6', '#b3a69d', '#8fa3b8', '#c2b8a4', '#95909f',
];

/** Smooth in, smooth out -- a lane change is a steering input, not a teleport. */
const smoothstep = (p: number): number => p * p * (3 - 2 * p);

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);

function worksIn(route: Route, lane: number, s: number): Works | undefined {
  return route.works.find((w) => w.lane === lane && s >= w.from - 1 && s <= w.to + 1);
}

/**
 * Lay out a road that is already busy. Cars are spaced by the band's density
 * and given the speed that spacing can actually support, so the queue you
 * start in is in equilibrium at t = 0 rather than a wall of cars that all
 * brake at once on the first frame.
 */
export function createSim(route: Route, car: CarSpec, seed = 1): Sim {
  let rng = seed | 0;
  const rnd = (): number => {
    const [value, next] = mulberry(rng);
    rng = next;
    return value;
  };

  const traffic: Vehicle[] = [];
  let id = 0;
  for (let lane = 0; lane < route.lanes; lane++) {
    // Lanes are not interchangeable. The nearside carries the lorries, the
    // buses and the people who are not in a hurry; the offside runs thinner.
    // On top of that each stretch of road shuffles its own mix, so which lane
    // is the good one differs from jam to jam and has to be read rather than
    // remembered. Without either, every lane moves at the same speed and
    // there is nothing to do in a queue but wait.
    const tilt = (route.lanes - 1 - 2 * lane) * 0.26;
    // Start the queue right at the line. In your own lane that is a promise
    // rather than a roll of the dice: the game opens on a bumper, not on
    // thirty metres of empty road and a jam somewhere up ahead.
    let s = lane === START_LANE ? 11.5 + rnd() * 2.5 : 8 + rnd() * 7;
    let lastS = -Infinity;
    let lastLength = 0;
    let lastV = 99;
    while (s < route.length - 30) {
      const band = route.bands.find((b) => s >= b.from && s < b.to) ?? route.bands[route.bands.length - 1];
      const crowding = (1 + tilt) * (0.72 + mix(band.from, lane) * 0.62);
      const slowness = (1 + tilt * 1.6) * (0.7 + mix(band.from + 7, lane) * 0.7);
      const spacing = 1000 / (band.density * crowding);
      const limit = limitAt(route, s);
      const dawdler = rnd() < Math.min(0.85, band.dawdlers * slowness);
      // A driver aims at a fraction of whatever the limit is *here*, so the
      // same car crawls downtown and keeps up on the expressway. Storing an
      // absolute speed instead walls the fast road with city traffic.
      const eagerness = dawdler ? 0.62 + rnd() * 0.2 : 0.9 + rnd() * 0.16;
      // Lorries: slow, long, and they live in the nearside lane.
      const lorry = rnd() < (lane === 0 ? 0.38 : lane === route.lanes - 1 ? 0.03 : 0.12);
      const topSpeed = lorry ? 21 + rnd() * 5 : 33 + rnd() * 22;
      const desired = Math.min(limit * eagerness, topSpeed);
      const length = lorry ? 7.5 + rnd() * 4 : 3.8 + rnd() * 1.6;
      // Both cars have a length. Spacing off this one alone parks a lorry
      // inside the hatchback behind it, and the queue opens the run already
      // overlapping -- which in a view from behind the bumper is not subtle.
      s = Math.max(s, lastS + (lastLength + length) / 2 + GAP_MIN + 0.4);
      if (s >= route.length - 30) break;
      const blocked = worksIn(route, lane, s);
      // Just enough room not to start the run already touching somebody.
      const nearStart = lane === START_LANE && s < 11;
      if (!blocked && !nearStart) {
        // The gap this car actually has decides how fast it can be going.
        const gap = s - lastS - (lastLength + length) / 2;
        const room = Number.isFinite(gap) ? Math.max(0, (gap - GAP_MIN) / GAP_TIME) : desired;
        traffic.push({
          id: id++, s, x: laneX(lane), lane, target: lane, cross: 0,
          v: Math.min(desired, room, lastV + 4),
          eagerness, topSpeed, desired, length, width: lorry ? 2.4 : 1.7 + rnd() * 0.3,
          colour: TRAFFIC_COLOURS[Math.floor(rnd() * TRAFFIC_COLOURS.length)],
          signal: 0, braking: false, cooldown: rnd() * 6, fussiness: 0.8 + rnd() * 2.2,
        });
        lastS = s;
        lastLength = length;
        lastV = traffic[traffic.length - 1].v;
      }
      s += spacing * (0.55 + rnd() * 0.9);
    }
  }

  return {
    t: 0,
    route,
    car,
    player: {
      s: 0, x: laneX(START_LANE), v: 0, lane: START_LANE, target: START_LANE, cross: 0,
      signal: 0, signalFor: 0, braking: false, gap: Infinity,
    },
    traffic,
    violations: [],
    crashed: null,
    finished: false,
    tailFor: 0,
    ranReds: [],
    flashes: [],
    rng,
    nextFlash: 1,
  };
}

interface Obstacle {
  s: number;
  length: number;
  v: number;
  id: number;
}

function buildLanes(sim: Sim): Obstacle[][] {
  const lanes: Obstacle[][] = [];
  for (let l = 0; l < sim.route.lanes; l++) lanes[l] = [];

  for (const veh of sim.traffic) {
    const ob = { s: veh.s, length: veh.length, v: veh.v, id: veh.id };
    lanes[veh.lane].push(ob);
    if (veh.target !== veh.lane) lanes[veh.target].push(ob);
  }

  const p = sim.player;
  const pob = { s: p.s, length: sim.car.length, v: p.v, id: PLAYER_ID };
  lanes[p.lane].push(pob);
  if (p.target !== p.lane) lanes[p.target].push(pob);

  for (const w of sim.route.works) {
    lanes[w.lane].push({ s: (w.from + w.to) / 2, length: w.to - w.from, v: 0, id: WORKS_ID });
  }

  for (const light of sim.route.lights) {
    if (phaseAt(light, sim.t) === 'green') continue;
    for (let l = 0; l < sim.route.lanes; l++) lanes[l].push({ s: light.s, length: 1, v: 0, id: LIGHT_ID });
  }

  for (const list of lanes) list.sort((a, b) => a.s - b.s);
  return lanes;
}

function firstAfter(list: Obstacle[], s: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].s <= s) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface Ahead {
  gap: number;
  v: number;
  id: number;
}

/**
 * Nearest thing ahead in a lane. A light you are already on top of is not a
 * thing ahead: if stopping for it would take more than `STOPPABLE`, you are
 * committed and the car behind you would be in your boot.
 */
function ahead(list: Obstacle[], s: number, halfLength: number, v: number, selfId: number): Ahead | null {
  for (let i = firstAfter(list, s); i < list.length; i++) {
    const o = list[i];
    if (o.id === selfId) continue;
    const gap = o.s - o.length / 2 - (s + halfLength);
    if (o.id === LIGHT_ID && gap > 0 && (v * v) / (2 * gap) > STOPPABLE) continue;
    return { gap: Math.max(0, gap), v: o.v, id: o.id };
  }
  return null;
}

function behind(list: Obstacle[], s: number, halfLength: number, selfId: number): Ahead | null {
  for (let i = firstAfter(list, s) - 1; i >= 0; i--) {
    const o = list[i];
    if (o.id === selfId || o.id === LIGHT_ID) continue;
    return { gap: Math.max(0, s - halfLength - (o.s + o.length / 2)), v: o.v, id: o.id };
  }
  return null;
}

function idm(v: number, desired: number, lead: Ahead | null): number {
  const free = IDM_ACCEL * (1 - Math.pow(v / Math.max(desired, 0.5), 4));
  if (!lead) return free;
  const dv = v - lead.v;
  const sStar = GAP_MIN + Math.max(0, v * GAP_TIME + (v * dv) / (2 * Math.sqrt(IDM_ACCEL * IDM_BRAKE)));
  return free - IDM_ACCEL * Math.pow(sStar / Math.max(lead.gap, 0.5), 2);
}

/** What a lane is worth to a driver: the speed it will actually let them hold. */
function laneValue(lead: Ahead | null, desired: number): number {
  if (!lead || lead.gap > 90) return desired;
  return Math.min(desired, lead.v + lead.gap / 18);
}

/** A slot another car has already decided to take this frame. */
interface Claim { lane: number; s: number; span: number }

/**
 * `urgent` is a driver who must leave this lane because it ends; `zip` is that
 * same driver with the cones in sight and no gap to be had, taking the one
 * that is there. Without it a closed lane in solid traffic never merges at
 * all, everything behind it stops for good, and the road quietly becomes
 * unfinishable.
 */
function safeToEnter(
  veh: Vehicle, lanes: Obstacle[][], lane: number, urgent: boolean, claims: Claim[], zip = false,
): boolean {
  // Two cars reading the same gap in the same frame both find it empty, and
  // both take it. Whoever decides first owns it.
  for (const c of claims) {
    if (c.lane === lane && Math.abs(c.s - veh.s) < (c.span + veh.length) * 0.6 + GAP_MIN + veh.v * 0.3) return false;
  }
  const list = lanes[lane];
  const half = veh.length / 2;
  const lead = ahead(list, veh.s, half, veh.v, veh.id);
  const trail = behind(list, veh.s, half, veh.id);
  const needLead = GAP_MIN + veh.length * 0.25 + veh.v * (zip ? 0.15 : urgent ? 0.35 : 0.6);
  if (lead && (lead.gap < needLead || lead.id === PLAYER_ID)) return false;
  if (!trail) return true;
  if (trail.id === PLAYER_ID) return false;
  const needTrail = GAP_MIN + veh.length * 0.2 + trail.v * (zip ? 0.12 : urgent ? 0.3 : 0.55);
  if (trail.gap < needTrail) return false;
  // Would the car behind have to stand on the brakes?
  const closing = trail.v - veh.v;
  const decel = closing > 0 ? (closing * closing) / (2 * Math.max(trail.gap, 0.5)) : 0;
  return decel < (zip ? 5 : urgent ? 3.5 : 2.2);
}

function stepTraffic(sim: Sim, lanes: Obstacle[][], dt: number, rnd: () => number): Vehicle[] {
  const claims: Claim[] = [];
  return sim.traffic.map((veh) => {
    const half = veh.length / 2;
    const desired = Math.min(veh.eagerness * limitAt(sim.route, veh.s), veh.topSpeed);
    const lead = ahead(lanes[veh.lane], veh.s, half, veh.v, veh.id);
    let a = idm(veh.v, desired, lead);

    if (veh.target !== veh.lane) {
      a = Math.min(a, idm(veh.v, desired, ahead(lanes[veh.target], veh.s, half, veh.v, veh.id)));
    }

    let lane = veh.lane;
    let target = veh.target;
    let cross = veh.cross;
    let signal = veh.signal;
    let cooldown = Math.max(0, veh.cooldown - dt);

    if (lane === target && cooldown === 0) {
      // The closed lane is not a preference, it is a wall with a date on it.
      const closure = sim.route.works.find((w) => w.lane === lane && w.from > veh.s && w.from - veh.s < 160);
      const urgent = closure !== undefined;
      // Cones in sight, crawling, nowhere to go: take what is there.
      const zip = closure !== undefined && closure.from - veh.s < 42 && veh.v < 9;
      const here = laneValue(lead, desired);
      let best = target;
      let bestValue = urgent ? -Infinity : here + veh.fussiness;
      for (const dir of [-1, 1]) {
        const c = lane + dir;
        if (c < 0 || c >= sim.route.lanes) continue;
        if (sim.route.works.some((w) => w.lane === c && w.from - 40 < veh.s + 120 && w.to > veh.s)) continue;
        if (!safeToEnter(veh, lanes, c, urgent, claims, zip)) continue;
        const value = laneValue(ahead(lanes[c], veh.s, half, veh.v, veh.id), desired);
        if (value > bestValue) {
          best = c;
          bestValue = value;
        }
      }
      if (best !== lane) {
        target = best;
        cross = 0;
        signal = best > lane ? 1 : -1;
        cooldown = 5 + rnd() * 5;
        claims.push({ lane: best, s: veh.s, span: veh.length });
      }
    }

    if (lane !== target) {
      cross += dt / 1.1;
      if (cross >= 1) {
        lane = target;
        cross = 0;
        signal = 0;
      }
    }

    const v = Math.max(0, veh.v + clamp(a, -PANIC, IDM_ACCEL) * dt);
    const x = lane === target ? laneX(lane) : laneX(lane) + (laneX(target) - laneX(lane)) * smoothstep(cross);
    return { ...veh, s: veh.s + v * dt, v, x, lane, target, cross, signal, braking: a < -0.8, cooldown, desired };
  });
}

/**
 * The constraint the driver model does not provide.
 *
 * IDM describes how people drive, not a promise that they never touch: in a
 * dense queue a hard brake leaves two cars briefly inside one another. On a
 * map that is a couple of pixels nobody sees. From behind your own bumper it
 * is two solid objects in the same place, which is the sort of thing you
 * cannot stop noticing once you have seen it.
 *
 * So after everyone has moved, walk each lane from the front and push anything
 * that ended up inside the car ahead back out of it. Corrections are under a
 * metre and invisible in motion. The player is in the ordering but is never
 * moved -- being shoved by the simulation is worse than any overlap.
 */
function separate(traffic: Vehicle[], player: PlayerState, car: CarSpec, lanes: number): Vehicle[] {
  const out = traffic.map((v) => ({ ...v }));
  for (let lane = 0; lane < lanes; lane++) {
    const here: Array<{ s: number; length: number; v: number; veh: Vehicle | null }> = [];
    for (const veh of out) {
      if (veh.lane === lane || veh.target === lane) here.push({ s: veh.s, length: veh.length, v: veh.v, veh });
    }
    if (player.lane === lane || player.target === lane) {
      here.push({ s: player.s, length: car.length, v: player.v, veh: null });
    }
    here.sort((a, b) => b.s - a.s);

    let rear = Infinity;
    let leadV = Infinity;
    for (const e of here) {
      const front = e.s + e.length / 2;
      if (e.veh && front > rear - 0.04) {
        e.veh.s = Math.min(e.veh.s, rear - 0.04 - e.length / 2);
        e.veh.v = Math.min(e.veh.v, Math.max(0, leadV));
        e.s = e.veh.s;
      }
      rear = e.s - e.length / 2;
      leadV = e.veh ? e.veh.v : e.v;
    }
  }
  return out;
}

function flash(sim: Sim, text: string, detail: string, tone: Flash['tone']): Flash[] {
  const next = [...sim.flashes, { id: sim.nextFlash, text, detail, tone, at: sim.t }];
  return next.slice(-6);
}

export function step(sim: Sim, input: Input, dt: number): Sim {
  if (sim.crashed || sim.finished) return sim;

  let rng = sim.rng;
  const rnd = (): number => {
    const [value, next] = mulberry(rng);
    rng = next;
    return value;
  };

  const { route, car } = sim;
  const lanes = buildLanes(sim);
  const p = sim.player;
  let violations = sim.violations;
  let flashes = sim.flashes;
  let nextFlash = sim.nextFlash;
  const note = (text: string, detail: string, tone: Flash['tone']): void => {
    flashes = flash({ ...sim, flashes, nextFlash }, text, detail, tone);
    nextFlash += 1;
  };

  // --- indicators -------------------------------------------------------
  let signal = p.signal;
  let signalFor = p.signalFor + dt;
  if (input.toggle !== 0) {
    signal = signal === input.toggle ? 0 : input.toggle;
    signalFor = 0;
  }

  // --- steering ---------------------------------------------------------
  let lane = p.lane;
  let target = p.target;
  let cross = p.cross;
  if (input.move !== 0 && lane === target) {
    const c = lane + input.move;
    if (c >= 0 && c < route.lanes) {
      target = c;
      cross = 0;
      if (signal !== input.move || signalFor < SIGNAL_LEAD) {
        violations = once(violations, 'no-signal', NO_SIGNAL_PENALTY, {
          t: sim.t, s: p.s, note: `Moved ${input.move < 0 ? 'left' : 'right'} without indicating`,
        });
        note('No indicator', `+${NO_SIGNAL_PENALTY}s`, 'bad');
      }
    }
  }
  if (lane !== target) {
    cross += dt / car.laneChange;
    if (cross >= 1) {
      lane = target;
      cross = 0;
      signal = 0;
    }
  }
  const x = lane === target ? laneX(lane) : laneX(lane) + (laneX(target) - laneX(lane)) * smoothstep(cross);

  // --- pedals -----------------------------------------------------------
  const top = car.topSpeed;
  let a: number;
  if (input.brake) a = -car.brake;
  else if (input.throttle) a = car.accel * Math.max(0, 1 - Math.pow(p.v / top, 2));
  else a = -(0.35 + 1.8 * Math.pow(p.v / top, 2));
  const v = clamp(p.v + a * dt, 0, top);
  const s = p.s + v * dt;

  // --- the law ----------------------------------------------------------
  const limit = limitAt(route, s);
  if (isSpeeding(v, limit)) {
    violations = accrue(violations, 'speeding', speedingRate(v, limit) * dt, {
      t: sim.t, s, note: `Over the limit in a ${Math.round(limit * 3.6)} zone`,
    });
  } else {
    violations = closeOut(violations, 'speeding');
  }

  let ranReds = sim.ranReds;
  for (const light of route.lights) {
    if (p.s < light.s && s >= light.s && !ranReds.includes(light.id) && phaseAt(light, sim.t) === 'red') {
      violations = once(violations, 'red-light', RED_LIGHT_PENALTY, {
        t: sim.t, s, note: 'Crossed the stop line on red',
      });
      note('Ran a red light', `+${RED_LIGHT_PENALTY}s`, 'bad');
      ranReds = [...ranReds, light.id];
    }
  }

  const lead = ahead(lanes[lane], s, car.length / 2, v, PLAYER_ID);
  const gap = lead ? lead.gap : Infinity;
  let tailFor = sim.tailFor;
  if (lead && lead.id >= 0 && headway(gap, v) < TAILGATE_HEADWAY && v > TAILGATE_MIN_SPEED) {
    tailFor += dt;
    if (tailFor > TAILGATE_GRACE) {
      violations = accrue(violations, 'tailgating', TAILGATE_RATE * dt, {
        t: sim.t, s, note: 'Following too closely',
      });
    }
  } else {
    tailFor = 0;
    violations = closeOut(violations, 'tailgating');
  }

  // --- metal ------------------------------------------------------------
  let crashed: Crash | null = null;
  for (const veh of sim.traffic) {
    if (Math.abs(veh.s - s) > 20) continue;
    const overlapS = Math.abs(veh.s - s) < (veh.length + car.length) / 2 - 0.05;
    const overlapX = Math.abs(veh.x - x) < (veh.width + car.width) / 2 - 0.12;
    if (overlapS && overlapX) {
      crashed = { what: veh.s > s ? 'the car in front' : 'the car alongside', s, t: sim.t };
      break;
    }
  }
  if (!crashed) {
    for (const w of route.works) {
      const inLane = Math.abs(x - laneX(w.lane)) < LANE_WIDTH / 2;
      if (inLane && s + car.length / 2 > w.from && s - car.length / 2 < w.to) {
        crashed = { what: 'the roadworks', s, t: sim.t };
        break;
      }
    }
  }

  const moved = stepTraffic(sim, lanes, dt, rnd);
  const traffic = separate(moved, { ...p, s, x, v, lane, target }, car, route.lanes);

  return {
    ...sim,
    t: sim.t + dt,
    player: { s, x, v, lane, target, cross, signal, signalFor, braking: input.brake, gap },
    traffic,
    violations,
    crashed,
    finished: s >= route.length,
    tailFor,
    ranReds,
    flashes,
    rng,
    nextFlash,
  };
}

/** Elapsed driving time plus every second the law took off you. */
export function total(sim: Sim): number {
  return sim.t + totalPenalty(sim.violations);
}

export interface Scan {
  lane: number;
  lead: Ahead | null;
  trail: Ahead | null;
}

/** Obstacle ids you can get back from a scan, for the ones that are not cars. */
export const OB_PLAYER = PLAYER_ID;
export const OB_WORKS = WORKS_ID;
export const OB_LIGHT = LIGHT_ID;

/** What is ahead of and behind the player in every lane, including its own. */
export function scanLanes(sim: Sim): Scan[] {
  const half = sim.car.length / 2;
  return buildLanes(sim).map((list, lane) => ({
    lane,
    lead: ahead(list, sim.player.s, half, sim.player.v, PLAYER_ID),
    trail: behind(list, sim.player.s, half, PLAYER_ID),
  }));
}

export interface Radar {
  s: number;
  lane: number;
  v: number;
  kind: 'car' | 'works' | 'light';
  phase?: 'green' | 'yellow' | 'red';
}

/** What the mirrors and the road ahead show, out to the car's sight line. */
export function radar(sim: Sim): Radar[] {
  const from = sim.player.s - 20;
  const to = sim.player.s + sim.car.lookahead;
  const out: Radar[] = [];
  for (const veh of sim.traffic) {
    if (veh.s > from && veh.s < to) out.push({ s: veh.s, lane: veh.lane, v: veh.v, kind: 'car' });
  }
  for (const w of sim.route.works) {
    if (w.to > from && w.from < to) out.push({ s: Math.max(w.from, from), lane: w.lane, v: 0, kind: 'works' });
  }
  for (const light of sim.route.lights) {
    if (light.s > from && light.s < to) {
      out.push({ s: light.s, lane: -1, v: 0, kind: 'light', phase: phaseAt(light, sim.t) });
    }
  }
  return out;
}
