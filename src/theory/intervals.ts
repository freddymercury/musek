/**
 * Intervals. The just ratios are what the ear actually wants; equal
 * temperament is the compromise that gets close to all of them at once.
 */

export interface Interval {
  semitones: number;
  name: string;
  short: string;
  justRatio: [number, number];
  /** How far equal temperament sits from the pure ratio, in cents. */
  temperamentError: number;
}

const RAW: Array<[number, string, string, [number, number]]> = [
  [0, 'Unison', 'P1', [1, 1]],
  [1, 'Minor second', 'm2', [16, 15]],
  [2, 'Major second', 'M2', [9, 8]],
  [3, 'Minor third', 'm3', [6, 5]],
  [4, 'Major third', 'M3', [5, 4]],
  [5, 'Perfect fourth', 'P4', [4, 3]],
  [6, 'Tritone', 'TT', [45, 32]],
  [7, 'Perfect fifth', 'P5', [3, 2]],
  [8, 'Minor sixth', 'm6', [8, 5]],
  [9, 'Major sixth', 'M6', [5, 3]],
  [10, 'Minor seventh', 'm7', [16, 9]],
  [11, 'Major seventh', 'M7', [15, 8]],
  [12, 'Octave', 'P8', [2, 1]],
];

export const INTERVALS: Interval[] = RAW.map(([semitones, name, short, justRatio]) => {
  const just = justRatio[0] / justRatio[1];
  const tempered = Math.pow(2, semitones / 12);
  return {
    semitones,
    name,
    short,
    justRatio,
    temperamentError: Math.round(1200 * Math.log2(tempered / just) * 100) / 100,
  };
});

export function interval(semitones: number): Interval {
  return INTERVALS[Math.abs(semitones) % 12 === 0 && Math.abs(semitones) > 0
    ? 12
    : Math.abs(semitones) % 12];
}

/**
 * Consonance ranked by ratio simplicity -- lower is more consonant.
 * This is just numerator+denominator of the just ratio, which tracks
 * how much of the harmonic series the two notes share.
 */
export function consonance(semitones: number): number {
  const iv = interval(semitones);
  return iv.justRatio[0] + iv.justRatio[1];
}

/** (3/2)^12 vs 2^7 -- the gap equal temperament exists to paper over. */
export const PYTHAGOREAN_COMMA = Math.pow(3 / 2, 12) / Math.pow(2, 7);
