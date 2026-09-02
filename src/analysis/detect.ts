import { CHORD_QUALITIES, type ChordQuality } from '../theory/chords';
import { pitchClass, pitchClassName, type PitchClass } from '../theory/pitch';
import { SCALE_STEPS, scalePitchClasses } from '../theory/scales';
import {
  chromaOf, cosineSimilarity, normalize, type Chroma, CHROMA_LENGTH,
} from './chroma';

/**
 * The recognizer is the theory module read backwards: the same interval sets
 * that build a chord become the template we match a chroma vector against.
 */

/** Qualities worth looking for in a real mix. Rarities only add false matches. */
const DETECTABLE: ChordQuality[] = [
  'maj', 'min', 'dom7', 'min7', 'maj7', 'dim', 'aug', 'sus2', 'sus4', 'five', 'min7b5',
];

/**
 * How much of a chord tone's energy leaks onto the pitch classes of its own
 * harmonics. Harmonic n sits 12*log2(n) semitones up: the 3rd is a fifth, the
 * 5th a major third, the 6th another fifth.
 *
 * The value is small and empirically chosen -- see the accuracy benchmark.
 * Modelling leakage at its full physical strength is far too much, because
 * the 1/f weighting in chromaFromSpectrum has already suppressed most of it
 * by the time we see a chroma vector. Zero is also wrong: with no leakage
 * modelled at all, every major triad scores higher as a major 7th, since the
 * fifth's 5th harmonic and the third's 3rd harmonic both land on the seventh.
 */
export const HARMONIC_LEAK = 0.2;

const HARMONICS = [2, 3, 4, 5, 6].map((n) => ({
  semitones: Math.round(12 * Math.log2(n)),
  weight: 1 / n,
}));

/**
 * A chord template: the notes it is built from, plus a little of the harmonic
 * energy those notes unavoidably produce. Roots and fifths lead, since they
 * survive a dense mix while thirds and sevenths are the first thing masked.
 */
export function templateFor(
  root: PitchClass,
  quality: ChordQuality,
  leak = HARMONIC_LEAK,
): Chroma {
  const intervals = CHORD_QUALITIES[quality].intervals;
  const template = new Float32Array(CHROMA_LENGTH);

  for (const iv of intervals) {
    const deg = iv % 12;
    const voice = deg === 0 ? 1.0 : deg === 7 ? 0.8 : 0.6;
    template[pitchClass(root + iv)] += voice;
    for (const h of HARMONICS) {
      template[pitchClass(root + iv + h.semitones)] += voice * h.weight * leak;
    }
  }

  return template;
}

export interface ChordCandidate {
  root: PitchClass;
  quality: ChordQuality;
  symbol: string;
  confidence: number; // 0-1
}

interface Template {
  root: PitchClass;
  quality: ChordQuality;
  symbol: string;
  vec: Chroma;
}

export function buildTemplates(leak = HARMONIC_LEAK): Template[] {
  const out: Template[] = [];
  for (let root = 0; root < CHROMA_LENGTH; root++) {
    for (const quality of DETECTABLE) {
      out.push({
        root: root as PitchClass,
        quality,
        symbol: `${pitchClassName(root)}${CHORD_QUALITIES[quality].symbol}`,
        vec: templateFor(root as PitchClass, quality, leak),
      });
    }
  }
  return out;
}

const TEMPLATES = buildTemplates();

/** Rank every chord template against a chroma frame. */
/**
 * How much energy an extra note must carry, relative to the average of the
 * triad tones, before we believe it.
 *
 * A triad's template is a subset of its seventh's, so any real C major also
 * matches Cmaj7 -- and cosine similarity rewards the larger template for the
 * harmonic energy a real instrument produces anyway. Uncorrected, this
 * mislabels essentially every major chord as a major 7th.
 *
 * A flat penalty per extra note fixes that but cannot win both cases: tuned
 * high enough to clean up triads, it makes genuine sevenths undetectable
 * (measured at exactly 0% recall). So the extra note is asked for evidence
 * instead of being taxed. A real seventh has a strong seventh in the chroma;
 * a triad's incidental harmonic leakage does not.
 *
 * Chosen by sweep; see src/testing/sweep.test.ts.
 */
export const EXTRA_NOTE_SUPPORT = 0.8;

/**
 * A setting that will hear genuine sevenths, at the cost of labelling some
 * plain triads as sevenths they are not.
 *
 * Chroma templates cannot do both well: measured across the benchmark, the
 * value that gets triads to ~92% drives seventh recall to near zero, and the
 * value that recovers sevenths costs about thirty points on triads. Rather
 * than pick for everyone, both are exposed -- triads suit pop and rock, this
 * suits jazz.
 */
export const SEVENTH_FRIENDLY_SUPPORT = 0.4;

/** Penalty applied to an extra note the audio does not support. */
export const UNSUPPORTED_PENALTY = 0.25;

const CORE_NOTES = 3;

/**
 * Score a candidate down for every note beyond the triad that the chroma
 * does not actually evidence. Pure.
 */
function evidenceFactor(
  norm: Chroma,
  root: PitchClass,
  quality: ChordQuality,
  support: number,
  penalty: number,
): number {
  const intervals = CHORD_QUALITIES[quality].intervals;
  if (intervals.length <= CORE_NOTES) return 1;

  let coreSum = 0;
  for (let i = 0; i < CORE_NOTES; i++) coreSum += norm[pitchClass(root + intervals[i])];
  const coreMean = coreSum / CORE_NOTES;
  if (coreMean <= 0) return 1;

  let factor = 1;
  for (let i = CORE_NOTES; i < intervals.length; i++) {
    const heard = norm[pitchClass(root + intervals[i])] / coreMean;
    if (heard < support) factor -= penalty;
  }
  return Math.max(0, factor);
}

export function detectChords(
  chroma: Chroma,
  top = 5,
  templates: readonly Template[] = TEMPLATES,
  support = EXTRA_NOTE_SUPPORT,
  penalty = UNSUPPORTED_PENALTY,
): ChordCandidate[] {
  const norm = normalize(chroma);
  return templates
    .map(({ root, quality, symbol, vec }) => ({
      root,
      quality,
      symbol,
      confidence:
        cosineSimilarity(norm, vec) * evidenceFactor(norm, root, quality, support, penalty),
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, top);
}

export function detectChord(
  chroma: Chroma,
  templates?: readonly Template[],
  support?: number,
  penalty?: number,
): ChordCandidate | null {
  const [best] = detectChords(chroma, 1, templates, support, penalty);
  return best && best.confidence > 0.5 ? best : null;
}

/**
 * Krumhansl-Schmuckler key finding: correlate the chroma against profiles
 * derived from how long listeners rated each scale degree as fitting a key.
 */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface KeyCandidate {
  tonic: PitchClass;
  mode: 'major' | 'minor';
  name: string;
  confidence: number;
}

function rotateProfile(profile: number[], by: number): number[] {
  return profile.map((_, i) => profile[(i - by + 12) % 12]);
}

export function detectKeys(chroma: Chroma, top = 3): KeyCandidate[] {
  const norm = normalize(chroma);
  const out: KeyCandidate[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    out.push({
      tonic: tonic as PitchClass,
      mode: 'major',
      name: `${pitchClassName(tonic)} major`,
      confidence: cosineSimilarity(norm, rotateProfile(MAJOR_PROFILE, tonic)),
    });
    out.push({
      tonic: tonic as PitchClass,
      mode: 'minor',
      name: `${pitchClassName(tonic)} minor`,
      confidence: cosineSimilarity(norm, rotateProfile(MINOR_PROFILE, tonic)),
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, top);
}

/**
 * Which detected chords actually belong to a key, and which are borrowed.
 * The out-of-key ones are usually the interesting part of a song.
 */
export function fitsKey(root: PitchClass, tonic: PitchClass, mode: 'major' | 'minor'): boolean {
  const pcs = scalePitchClasses(tonic, mode === 'major' ? 'major' : 'naturalMinor');
  return pcs.includes(pitchClass(root));
}

/** Best-matching scale for a chroma vector, across every scale we know. */
export function detectScale(chroma: Chroma): { root: PitchClass; scale: string; confidence: number } {
  const norm = normalize(chroma);
  let best = { root: 0 as PitchClass, scale: 'major', confidence: -1 };
  for (const name of Object.keys(SCALE_STEPS)) {
    if (name === 'chromatic') continue;
    for (let root = 0; root < 12; root++) {
      const vec = chromaOf(scalePitchClasses(root, name as keyof typeof SCALE_STEPS));
      const confidence = cosineSimilarity(norm, vec);
      if (confidence > best.confidence) {
        best = { root: root as PitchClass, scale: name, confidence };
      }
    }
  }
  return best;
}
