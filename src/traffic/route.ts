/**
 * The road to the arena.
 *
 * A route is data, not code: zones that set the limit, lights that cycle,
 * roadworks that close a lane, and bands that say how thick the traffic is.
 * The simulation reads it; nothing here knows the simulation exists.
 *
 * The one clever bit is the green wave. Real arterials time their lights so a
 * car holding the limit meets them all green, and that timing is what makes
 * obeying the limit the fast line rather than the virtuous one: speed between
 * two lights and all you buy is a longer wait at the second. `greenWave`
 * computes those offsets from an assumed progress speed instead of leaving
 * them to taste.
 */
import { fromKmh } from './cars';

export interface Zone {
  from: number;
  to: number;
  /** Posted limit, m/s. */
  limit: number;
  name: string;
}

export interface Light {
  id: string;
  /** Stop line, metres along the route. */
  s: number;
  green: number;
  yellow: number;
  red: number;
  /** Seconds added to the clock before the phase is read. */
  offset: number;
}

export interface Works {
  id: string;
  lane: number;
  from: number;
  to: number;
  reason: string;
}

/** How thick the traffic is over a stretch of road. */
export interface Band {
  from: number;
  to: number;
  /** Vehicles per kilometre per lane. */
  density: number;
  /** Fraction of those drivers who want to go well under the limit. */
  dawdlers: number;
}

export interface Route {
  name: string;
  /** Where you are trying to sit down. */
  seat: string;
  /** Metres from the start of the queue to the arena car park. */
  length: number;
  lanes: number;
  zones: Zone[];
  lights: Light[];
  works: Works[];
  bands: Band[];
  /** The curtain, in seconds. Beat it and you are in your seat for the overture. */
  par: number;
  /**
   * The traffic everyone races. Par means nothing against a road that is
   * different every attempt, so the default run is always this one and a
   * shuffled road is offered as its own thing.
   */
  raceDay: number;
}

export const LANE_WIDTH = 3.5;

/**
 * Phase offset that greets a driver arriving at `arrival` with a light that
 * went green `lead` seconds earlier.
 */
export function waveOffset(arrival: number, cycle: number, lead = 6): number {
  return ((lead - arrival) % cycle + cycle) % cycle;
}

/** Metres of queue at the start, and how long a competent driver needs to clear it. */
export const JAM_END = 200;
export const JAM_TIME = 29;

/**
 * When a driver who clears the opening queue and then sits on the limit
 * arrives at `s`. This is what the wave is timed against, and timing it
 * against anything slower quietly makes the limit the wrong speed to drive.
 */
export function paceTo(zones: Zone[], s: number): number {
  let t = JAM_TIME;
  let at = JAM_END;
  while (at < s) {
    const zone = zones.find((z) => at >= z.from && at < z.to) ?? zones[zones.length - 1];
    const next = Math.min(s, zone.to);
    t += (next - at) / (zone.limit * 0.95);
    at = next;
  }
  return t;
}

export type Phase = 'green' | 'yellow' | 'red';

export function phaseAt(light: Light, t: number): Phase {
  const cycle = light.green + light.yellow + light.red;
  const p = ((t + light.offset) % cycle + cycle) % cycle;
  if (p < light.green) return 'green';
  if (p < light.green + light.yellow) return 'yellow';
  return 'red';
}

/** Seconds until this light next turns green (0 if it is green now). */
export function greenIn(light: Light, t: number): number {
  const cycle = light.green + light.yellow + light.red;
  const p = ((t + light.offset) % cycle + cycle) % cycle;
  return p < light.green ? 0 : cycle - p;
}

export function limitAt(route: Route, s: number): number {
  for (const z of route.zones) if (s >= z.from && s < z.to) return z.limit;
  return route.zones[route.zones.length - 1].limit;
}

export function zoneAt(route: Route, s: number): Zone {
  for (const z of route.zones) if (s >= z.from && s < z.to) return z;
  return route.zones[route.zones.length - 1];
}

export function densityAt(route: Route, s: number): Band {
  for (const b of route.bands) if (s >= b.from && s < b.to) return b;
  return route.bands[route.bands.length - 1];
}

const city = fromKmh(50);
const riverside = fromKmh(60);

/**
 * Downtown, an avenue with a lane closed, the coast expressway, then the
 * crawl up to the arena. Lights only exist where the limit is low, which is
 * also where the wave is worth catching.
 */
const ARENA_ZONES: Zone[] = [
  { from: 0, to: 800, limit: city, name: 'Downtown' },
  { from: 800, to: 1300, limit: riverside, name: 'Riverside Avenue' },
  { from: 1300, to: 2150, limit: fromKmh(100), name: 'Coast Expressway' },
  { from: 2150, to: 2600, limit: fromKmh(40), name: 'Arena Approach' },
];

/** A light timed to the wave: green just before a limit-abiding driver arrives. */
const wave = (id: string, s: number, green: number, yellow: number, red: number): Light => ({
  id, s, green, yellow, red, offset: waveOffset(paceTo(ARENA_ZONES, s), green + yellow + red),
});

export const ARENA_ROUTE: Route = {
  name: 'Meridian Arena, Gate C',
  seat: 'Row D, seat 14',
  length: 2600,
  lanes: 3,
  zones: ARENA_ZONES,
  lights: [
    wave('l1', 260, 22, 3, 11),
    wave('l2', 1240, 22, 3, 11),
    wave('l3', 2330, 20, 3, 13),
  ],
  works: [
    { id: 'w1', lane: 0, from: 950, to: 1150, reason: 'Resurfacing' },
    { id: 'w2', lane: 2, from: 2420, to: 2500, reason: 'Event barriers' },
  ],
  bands: [
    { from: 0, to: 200, density: 38, dawdlers: 0.5 },
    { from: 200, to: 800, density: 13, dawdlers: 0.2 },
    { from: 800, to: 1300, density: 12, dawdlers: 0.2 },
    { from: 1300, to: 2150, density: 8, dawdlers: 0.12 },
    { from: 2150, to: 2600, density: 14, dawdlers: 0.28 },
  ],
  par: 228,
  raceDay: 4,
};

/** Seconds left in the phase this light is currently showing. */
export function phaseLeft(light: Light, t: number): number {
  const cycle = light.green + light.yellow + light.red;
  const p = ((t + light.offset) % cycle + cycle) % cycle;
  if (p < light.green) return light.green - p;
  if (p < light.green + light.yellow) return light.green + light.yellow - p;
  return cycle - p;
}

export function nextLight(route: Route, s: number, within = 400): Light | null {
  let best: Light | null = null;
  for (const l of route.lights) {
    if (l.s > s && l.s - s < within && (!best || l.s < best.s)) best = l;
  }
  return best;
}
