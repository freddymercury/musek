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
 * Templates weight the root and fifth above the rest: they survive in a dense
 * mix, while thirds and sevenths are the first thing masked by distortion.
 */
function templateFor(root: PitchClass, quality: ChordQuality): Chroma {
  const intervals = CHORD_QUALITIES[quality].intervals;
  const weights = intervals.map((iv) => {
    const deg = iv % 12;
    if (deg === 0) return 1.0;
    if (deg === 7) return 0.8;
    return 0.6;
  });
  return chromaOf(intervals.map((iv) => pitchClass(root + iv)), weights);
}

export interface ChordCandidate {
  root: PitchClass;
  quality: ChordQuality;
  symbol: string;
  confidence: number; // 0-1
}

const TEMPLATES: Array<{ root: PitchClass; quality: ChordQuality; symbol: string; vec: Chroma }> = [];
for (let root = 0; root < CHROMA_LENGTH; root++) {
  for (const quality of DETECTABLE) {
    TEMPLATES.push({
      root: root as PitchClass,
      quality,
      symbol: `${pitchClassName(root)}${CHORD_QUALITIES[quality].symbol}`,
      vec: templateFor(root as PitchClass, quality),
    });
  }
}

/** Rank every chord template against a chroma frame. */
export function detectChords(chroma: Chroma, top = 5): ChordCandidate[] {
  const norm = normalize(chroma);
  return TEMPLATES
    .map(({ root, quality, symbol, vec }) => ({
      root,
      quality,
      symbol,
      confidence: cosineSimilarity(norm, vec),
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, top);
}

export function detectChord(chroma: Chroma): ChordCandidate | null {
  const [best] = detectChords(chroma, 1);
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
