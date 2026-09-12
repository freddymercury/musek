/**
 * The garage.
 *
 * Every stat is SI -- metres, m/s, m/s^2 -- because the simulation is, and a
 * stat that needs converting before it can be used is a stat that will one day
 * be converted twice. The dashboard is the only place km/h exists.
 *
 * The roster is built around one idea: no car is better, each is better
 * somewhere. Top speed only pays where the limit is high, acceleration only
 * pays in stop-start queues, agility only pays where the gaps are small, and
 * `lookahead` -- how far up the road the radar reads -- is the van's
 * compensation for being slow, because you genuinely can see over a jam from
 * up there.
 */
export interface CarSpec {
  id: string;
  name: string;
  blurb: string;
  /** Bumper to bumper, metres. Long cars need long gaps to merge into. */
  length: number;
  width: number;
  /** Governed top speed, m/s. */
  topSpeed: number;
  /** Full throttle, m/s^2. */
  accel: number;
  /** Full brakes, m/s^2. */
  brake: number;
  /** Seconds to cross one lane. */
  laneChange: number;
  /** How far up the road the radar strip reads, metres. */
  lookahead: number;
  body: string;
  trim: string;
}

export const CARS: CarSpec[] = [
  {
    id: 'hatchback',
    name: 'Commuter Hatchback',
    blurb: 'Nothing special, nothing missing. Every stat is the average of the others.',
    length: 4.0, width: 1.75,
    topSpeed: 39, accel: 2.9, brake: 8.2, laneChange: 0.85, lookahead: 190,
    body: '#5d8bd6', trim: '#cfe0f7',
  },
  {
    id: 'ev',
    name: 'Electric Sedan',
    blurb: 'Torque from a standstill and brakes that regenerate. The queue is where it wins.',
    length: 4.8, width: 1.88,
    topSpeed: 47, accel: 5.0, brake: 8.8, laneChange: 0.8, lookahead: 185,
    body: '#6fc8b4', trim: '#d8f2ec',
  },
  {
    id: 'coupe',
    name: 'Sports Coupe',
    blurb: 'Quickest thing here by a street. Sits so low you see the bumper ahead and little else.',
    length: 4.4, width: 1.9,
    topSpeed: 63, accel: 5.4, brake: 9.6, laneChange: 0.6, lookahead: 150,
    body: '#e2726e', trim: '#ffd9d7',
  },
  {
    id: 'roadster',
    name: 'Vintage Roadster',
    blurb: 'Short and light. Fits through gaps nothing else fits through; runs out of top end early.',
    length: 3.7, width: 1.68,
    topSpeed: 44, accel: 3.6, brake: 8.0, laneChange: 0.55, lookahead: 165,
    body: '#f0b866', trim: '#fff0d6',
  },
  {
    id: 'van',
    name: 'Delivery Van',
    blurb: 'Slow, wide and awkward to place -- but from up there you can see the whole jam coming.',
    length: 5.7, width: 2.1,
    topSpeed: 33, accel: 1.9, brake: 6.4, laneChange: 1.3, lookahead: 300,
    body: '#b7bdcc', trim: '#eef1f7',
  },
];

export const carById = (id: string): CarSpec => CARS.find((c) => c.id === id) ?? CARS[0];

export const kmh = (metresPerSecond: number): number => metresPerSecond * 3.6;
export const fromKmh = (kilometresPerHour: number): number => kilometresPerHour / 3.6;
