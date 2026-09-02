import { CHORD_QUALITIES, type ChordQuality } from '../theory/chords';
import { pitchClass } from '../theory/pitch';
import type { Segment } from './timeline';

/**
 * Turning a detected timeline into something playable.
 *
 * Pure: segments in, scheduled events out. The transport that actually makes
 * sound does no musical thinking, it just plays what this decides.
 */

export interface Event {
  /** Song position, in seconds. */
  time: number;
  duration: number;
  /** MIDI notes, already voiced. */
  notes: number[];
  symbol: string;
  /** Root pitch class, for a bass voice. */
  root: number;
  confidence: number;
}

/** Middle of the piano, where chords sit without muddiness or shrillness. */
export const CENTRE = 60;

/**
 * Choose the inversion of `pcs` closest to where the last chord sat.
 *
 * Played always in root position, a progression leaps around and sounds
 * nothing like the record. Real players move as little as possible between
 * chords, which is also what makes the transcription easy to follow by ear.
 * Pure.
 */
export function voice(pcs: number[], previous: number[] | null): number[] {
  const target = previous?.length
    ? previous.reduce((a, b) => a + b, 0) / previous.length
    : CENTRE;

  // Every octave placement of each pitch class, nearest the target register.
  const candidates = pcs.map((pc) => {
    const base = pitchClass(pc);
    let best = base + 12 * Math.round((target - base) / 12);
    // Keep voices inside a sane range whatever the target was.
    while (best < 36) best += 12;
    while (best > 84) best -= 12;
    return best;
  });

  return [...new Set(candidates)].sort((a, b) => a - b);
}

/** Notes of a chord quality above a root pitch class, unvoiced. Pure. */
export function notesOf(root: number, quality: ChordQuality): number[] {
  const intervals = CHORD_QUALITIES[quality]?.intervals ?? CHORD_QUALITIES.maj.intervals;
  return intervals.map((iv) => pitchClass(root + iv));
}

export interface ArrangeOptions {
  /** Skip segments the analyser was unsure about. */
  minConfidence?: number;
  /** Shortest event worth sounding, in seconds. */
  minDuration?: number;
}

/**
 * Turn a detected timeline into a playable arrangement, voiced so that
 * consecutive chords move smoothly. Pure.
 */
export function arrange(
  segments: readonly Segment[],
  opts: ArrangeOptions = {},
): Event[] {
  const { minConfidence = 0, minDuration = 0 } = opts;

  const events: Event[] = [];
  let previous: number[] | null = null;

  for (const s of segments) {
    const duration = s.end - s.start;
    if (duration < minDuration || s.confidence < minConfidence) continue;

    const notes = voice(notesOf(s.root, s.quality as ChordQuality), previous);
    previous = notes;

    events.push({
      time: s.start,
      duration,
      notes,
      symbol: s.symbol,
      root: pitchClass(s.root),
      confidence: s.confidence,
    });
  }

  return events;
}

/** Events that start at or after `from`, rebased so `from` becomes zero. Pure. */
export function fromPosition(events: readonly Event[], from: number): Event[] {
  return events
    .filter((e) => e.time + e.duration > from)
    .map((e) => ({
      ...e,
      time: Math.max(0, e.time - from),
      duration: e.time < from ? e.duration - (from - e.time) : e.duration,
    }));
}

/** Total length of an arrangement, in seconds. Pure. */
export function arrangementLength(events: readonly Event[]): number {
  return events.reduce((max, e) => Math.max(max, e.time + e.duration), 0);
}
