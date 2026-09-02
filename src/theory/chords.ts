import { pitchClass, pitchClassName, type PitchClass } from './pitch';
import { degree, scale, type ScaleName } from './scales';

/** Chord qualities as semitone offsets from the root. */
export const CHORD_QUALITIES = {
  maj:      { intervals: [0, 4, 7],      symbol: '',      label: 'major' },
  min:      { intervals: [0, 3, 7],      symbol: 'm',     label: 'minor' },
  dim:      { intervals: [0, 3, 6],      symbol: '°',     label: 'diminished' },
  aug:      { intervals: [0, 4, 8],      symbol: '+',     label: 'augmented' },
  sus2:     { intervals: [0, 2, 7],      symbol: 'sus2',  label: 'suspended 2nd' },
  sus4:     { intervals: [0, 5, 7],      symbol: 'sus4',  label: 'suspended 4th' },
  maj7:     { intervals: [0, 4, 7, 11],  symbol: 'maj7',  label: 'major 7th' },
  min7:     { intervals: [0, 3, 7, 10],  symbol: 'm7',    label: 'minor 7th' },
  dom7:     { intervals: [0, 4, 7, 10],  symbol: '7',     label: 'dominant 7th' },
  min7b5:   { intervals: [0, 3, 6, 10],  symbol: 'm7♭5',  label: 'half-diminished' },
  dim7:     { intervals: [0, 3, 6, 9],   symbol: '°7',    label: 'diminished 7th' },
  minMaj7:  { intervals: [0, 3, 7, 11],  symbol: 'mMaj7', label: 'minor-major 7th' },
  maj6:     { intervals: [0, 4, 7, 9],   symbol: '6',     label: 'major 6th' },
  min6:     { intervals: [0, 3, 7, 9],   symbol: 'm6',    label: 'minor 6th' },
  maj9:     { intervals: [0, 4, 7, 11, 14], symbol: 'maj9', label: 'major 9th' },
  dom9:     { intervals: [0, 4, 7, 10, 14], symbol: '9',    label: 'dominant 9th' },
  min9:     { intervals: [0, 3, 7, 10, 14], symbol: 'm9',   label: 'minor 9th' },
  five:     { intervals: [0, 7],         symbol: '5',     label: 'power chord' },
} as const;

export type ChordQuality = keyof typeof CHORD_QUALITIES;

export interface Chord {
  root: number;          // MIDI note
  quality: ChordQuality;
  notes: number[];       // MIDI notes
  symbol: string;        // "Cmaj7"
}

export function chord(root: number, quality: ChordQuality = 'maj'): Chord {
  const { intervals, symbol } = CHORD_QUALITIES[quality];
  return {
    root,
    quality,
    notes: intervals.map((i) => root + i),
    symbol: `${pitchClassName(pitchClass(root))}${symbol}`,
  };
}

/** Voice a chord in a target register without changing its identity. */
export function invert(c: Chord, n: number): Chord {
  const notes = [...c.notes];
  for (let i = 0; i < n; i++) notes.push(notes.shift()! + 12);
  return { ...c, notes };
}

/** Stack every other scale degree -- the article's [0,2,4] trick. */
export function triadOnDegree(root: number, scaleName: ScaleName, deg: number): number[] {
  const notes = scale(root, scaleName);
  return [0, 2, 4].map((i) => degree(notes, deg + i));
}

export function seventhOnDegree(root: number, scaleName: ScaleName, deg: number): number[] {
  const notes = scale(root, scaleName);
  return [0, 2, 4, 6].map((i) => degree(notes, deg + i));
}

export interface Identified {
  root: PitchClass;
  quality: ChordQuality;
  symbol: string;
}

const SHAPES = Object.entries(CHORD_QUALITIES).map(([name, def]) => ({
  name: name as ChordQuality,
  symbol: def.symbol,
  shape: [...new Set(def.intervals.map((i) => i % 12))].sort((a, b) => a - b),
}));

function matches(shape: number[], want: number[]): boolean {
  return want.length === shape.length && want.every((v, i) => v === shape[i]);
}

/** Match against a root we already know. */
export function qualityFor(root: number, notes: number[]): ChordQuality | null {
  const pcs = [...new Set(notes.map((n) => pitchClass(n - root)))].sort((a, b) => a - b);
  return SHAPES.find((s) => matches(s.shape, pcs))?.name ?? null;
}

/**
 * Identify a chord from notes in any order, octave, or inversion -- which is
 * what audio analysis hands us, with no idea which pitch class is the root.
 *
 * Qualities are tried outermost, simplest first, because the same pitch-class
 * set is often two chords: {A,C,E} is both Am and C6, and {A,C,E,G} is both
 * Am7 and C6. Checking every root for a plain triad before trying any root
 * for a 6th picks the reading a musician would write down.
 */
export function identify(notes: number[]): Identified | null {
  const pcs = [...new Set(notes.map(pitchClass))].sort((a, b) => a - b);
  for (const { name, symbol, shape } of SHAPES) {
    if (shape.length !== pcs.length) continue;
    for (const root of pcs) {
      const rel = pcs.map((p) => pitchClass(p - root)).sort((a, b) => a - b);
      if (matches(shape, rel)) {
        return { root, quality: name, symbol: `${pitchClassName(root)}${symbol}` };
      }
    }
  }
  return null;
}

/** Quality of a chord whose first note is its root. */
export function qualityOf(notes: number[]): ChordQuality | null {
  return identify(notes)?.quality ?? null;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export interface DiatonicChord extends Chord {
  degree: number;
  roman: string;
  function: 'tonic' | 'subdominant' | 'dominant';
}

const FUNCTIONS: Array<DiatonicChord['function']> = [
  'tonic', 'subdominant', 'tonic', 'subdominant', 'dominant', 'tonic', 'dominant',
];

/**
 * The seven diatonic chords of a key. Roman numerals are relative addressing:
 * the same progression in any key is the same array plus a constant.
 */
export function diatonicChords(
  root: number,
  scaleName: ScaleName = 'major',
  sevenths = false,
): DiatonicChord[] {
  return Array.from({ length: 7 }, (_, deg) => {
    const notes = sevenths
      ? seventhOnDegree(root, scaleName, deg)
      : triadOnDegree(root, scaleName, deg);
    const quality = qualityFor(notes[0], notes) ?? 'maj';
    const isMinorish = quality.startsWith('min') || quality.startsWith('dim');
    let roman = isMinorish ? ROMAN[deg].toLowerCase() : ROMAN[deg];
    if (quality === 'dim' || quality === 'dim7') roman += '°';
    if (quality === 'min7b5') roman += 'ø';
    if (quality === 'aug') roman += '+';
    if (sevenths && !roman.includes('°') && !roman.includes('ø')) roman += '7';
    return {
      root: notes[0],
      quality,
      notes,
      symbol: `${pitchClassName(pitchClass(notes[0]))}${CHORD_QUALITIES[quality].symbol}`,
      degree: deg,
      roman,
      function: FUNCTIONS[deg],
    };
  });
}

/** Parse "vi-IV-I-V" into actual chords in a given key. */
export function progression(
  root: number,
  numerals: string[],
  scaleName: ScaleName = 'major',
): DiatonicChord[] {
  const chords = diatonicChords(root, scaleName);
  return numerals.map((n) => {
    const clean = n.replace(/[°ø+7]/g, '').trim();
    const idx = ROMAN.indexOf(clean.toUpperCase());
    if (idx === -1) throw new Error(`Unknown numeral: ${n}`);
    return chords[idx];
  });
}

/**
 * Tension score. The tritone is the most unstable interval available, and
 * the leading tone wants to resolve up by a semitone -- both are why V pulls
 * toward I so hard.
 */
export function tension(notes: number[]): number {
  const pcs = notes.map(pitchClass);
  let score = 0;
  for (let i = 0; i < pcs.length; i++) {
    for (let j = i + 1; j < pcs.length; j++) {
      const gap = Math.min(
        ((pcs[j] - pcs[i]) % 12 + 12) % 12,
        ((pcs[i] - pcs[j]) % 12 + 12) % 12,
      );
      if (gap === 6) score += 3;   // tritone
      if (gap === 1) score += 2;   // semitone clash
      if (gap === 2) score += 1;
    }
  }
  return score;
}

export type PitchClassSet = PitchClass[];
