/**
 * Pitch: the arithmetic layer. Everything above this file speaks in MIDI
 * integers, which is the whole payoff of equal temperament -- notes become
 * numbers you can add to.
 */

export const A4_MIDI = 69;
export const A4_HZ = 440;
export const SEMITONE = Math.pow(2, 1 / 12);

export const PITCH_CLASSES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

export const FLAT_NAMES = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
] as const;

export type PitchClass = number; // 0-11, C = 0

/** midiToFreq(69) === 440 */
export function midiToFreq(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** Inverse of midiToFreq. Returns a float; round it for the nearest note. */
export function freqToMidi(hz: number): number {
  return A4_MIDI + 12 * Math.log2(hz / A4_HZ);
}

/** How far off the nearest equal-tempered note a frequency is, in cents. */
export function centsOff(hz: number): number {
  const exact = freqToMidi(hz);
  return Math.round((exact - Math.round(exact)) * 100);
}

export function pitchClass(midi: number): PitchClass {
  return ((midi % 12) + 12) % 12;
}

export function octave(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

export function noteName(midi: number, flats = false): string {
  const names = flats ? FLAT_NAMES : PITCH_CLASSES;
  return `${names[pitchClass(midi)]}${octave(midi)}`;
}

export function pitchClassName(pc: PitchClass, flats = false): string {
  return (flats ? FLAT_NAMES : PITCH_CLASSES)[((pc % 12) + 12) % 12];
}

/** Parse "C#4", "Bb2", "F" (defaults to octave 4) into a MIDI number. */
export function parseNote(name: string): number {
  const m = /^([A-Ga-g])([#b]*)(-?\d+)?$/.exec(name.trim());
  if (!m) throw new Error(`Unparseable note: ${name}`);
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()]!;
  let accidental = 0;
  for (const ch of m[2]) accidental += ch === '#' ? 1 : -1;
  const oct = m[3] === undefined ? 4 : parseInt(m[3], 10);
  return (oct + 1) * 12 + base + accidental;
}

/** The harmonic series above a fundamental -- why any of this sounds good. */
export function harmonics(fundamentalHz: number, count = 8): number[] {
  return Array.from({ length: count }, (_, i) => fundamentalHz * (i + 1));
}
