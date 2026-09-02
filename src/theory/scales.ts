import { pitchClass, type PitchClass } from './pitch';

/** Scales are step patterns that sum to 12. */
export const SCALE_STEPS = {
  major:            [2, 2, 1, 2, 2, 2, 1],
  naturalMinor:     [2, 1, 2, 2, 1, 2, 2],
  harmonicMinor:    [2, 1, 2, 2, 1, 3, 1],
  melodicMinor:     [2, 1, 2, 2, 2, 2, 1],
  majorPentatonic:  [2, 2, 3, 2, 3],
  minorPentatonic:  [3, 2, 2, 3, 2],
  blues:            [3, 2, 1, 1, 3, 2],
  wholeTone:        [2, 2, 2, 2, 2, 2],
  chromatic:        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
} as const;

export type ScaleName = keyof typeof SCALE_STEPS;

/** The seven modes are rotations of the major pattern. */
export const MODES = [
  'ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian',
] as const;

export type ModeName = (typeof MODES)[number];

export function rotate<T>(arr: readonly T[], n: number): T[] {
  const len = arr.length;
  const k = ((n % len) + len) % len;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

export function modeSteps(mode: ModeName): number[] {
  return rotate(SCALE_STEPS.major, MODES.indexOf(mode));
}

/** Cumulative sum of the step pattern -> semitone offsets from the root. */
export function stepsToOffsets(steps: readonly number[]): number[] {
  const offsets = [0];
  for (const s of steps.slice(0, -1)) offsets.push(offsets[offsets.length - 1] + s);
  return offsets;
}

/** Absolute MIDI notes for a scale starting at `root`. */
export function scale(root: number, name: ScaleName = 'major'): number[] {
  return stepsToOffsets(SCALE_STEPS[name]).map((o) => root + o);
}

export function mode(root: number, name: ModeName): number[] {
  return stepsToOffsets(modeSteps(name)).map((o) => root + o);
}

/** Pitch-class set of a scale, for matching against detected audio. */
export function scalePitchClasses(root: number, name: ScaleName = 'major'): PitchClass[] {
  return scale(root, name).map(pitchClass);
}

/**
 * Index into a scale with wrapping, so degree 7 is the octave above degree 0.
 * This is what lets chords be built by stepping every other degree.
 */
export function degree(notes: number[], i: number): number {
  const len = notes.length;
  const wrapped = ((i % len) + len) % len;
  const octaves = Math.floor(i / len);
  return notes[wrapped] + 12 * octaves;
}
