import type { ChordCandidate } from './detect';

/**
 * The timeline layer is deliberately pure: every function here takes state and
 * an observation and returns new state. Nothing reads a clock, touches audio,
 * or mutates its arguments -- the live capture loop is the only thing that
 * knows about time passing, and it just feeds observations in here.
 *
 * That is what makes a second listening pass work. Replaying the same song
 * produces more observations at known song positions, and merging them is a
 * fold over data rather than anything stateful.
 */

export interface Observation {
  /** Position in the song, in seconds -- not wall clock. */
  time: number;
  candidate: ChordCandidate;
}

export interface Segment {
  start: number;
  end: number;
  symbol: string;
  root: number;
  quality: string;
  /** Mean confidence across every observation that landed in this segment. */
  confidence: number;
  /** How many observations agreed. More passes means a firmer reading. */
  support: number;
}

export interface TimelineState {
  segments: readonly Segment[];
}

export const emptyTimeline: TimelineState = { segments: [] };

/** Shortest chord we will believe, in seconds. Below this it is noise. */
export const MIN_SEGMENT = 0.4;

/**
 * How much song each observation accounts for, in seconds -- the analysis
 * hop size. A segment lasts from its first observation until its last
 * observation plus one hop, and no further.
 *
 * The alternative, running each segment up to the next chord change, would
 * credit a single stray frame with seconds of duration it was never heard
 * for, which is exactly the noise we want prune() to remove.
 */
export const HOP = 0.1;

/**
 * Collapse consecutive observations of the same chord into segments.
 * Pure: same observations in, same segments out, input untouched.
 */
export function segmentsFrom(
  observations: readonly Observation[],
  hop = HOP,
): Segment[] {
  const sorted = [...observations].sort((a, b) => a.time - b.time);
  const out: Segment[] = [];

  for (const obs of sorted) {
    const last = out[out.length - 1];
    // Contiguous only if the same chord and no real gap. Observations arrive
    // on jittery timestamps, so allow half a hop of slack before calling it
    // a break in listening.
    if (last && last.symbol === obs.candidate.symbol && obs.time <= last.end + hop * 0.5) {
      const support = last.support + 1;
      out[out.length - 1] = {
        ...last,
        end: obs.time + hop,
        support,
        confidence: (last.confidence * last.support + obs.candidate.confidence) / support,
      };
    } else {
      // Never overlap the segment we are leaving behind.
      if (last && last.end > obs.time) out[out.length - 1] = { ...last, end: obs.time };
      out.push({
        start: obs.time,
        end: obs.time + hop,
        symbol: obs.candidate.symbol,
        root: obs.candidate.root,
        quality: obs.candidate.quality,
        confidence: obs.candidate.confidence,
        support: 1,
      });
    }
  }

  return out;
}

/**
 * Drop segments too short to be real. With end times bounded by the hop size,
 * a one-frame blip is one hop long and disappears here, while a chord that
 * genuinely sustained keeps its full duration.
 */
export function prune(segments: readonly Segment[], min = MIN_SEGMENT): Segment[] {
  return segments.filter((s) => s.end - s.start >= min);
}

/** Fold one observation into existing state. Pure. */
export function observe(
  state: TimelineState,
  obs: Observation,
  hop = HOP,
): TimelineState {
  const last = state.segments[state.segments.length - 1];

  if (last && last.symbol === obs.candidate.symbol && obs.time <= last.end + hop * 0.5) {
    const support = last.support + 1;
    return {
      segments: [
        ...state.segments.slice(0, -1),
        {
          ...last,
          end: Math.max(last.end, obs.time + hop),
          support,
          confidence: (last.confidence * last.support + obs.candidate.confidence) / support,
        },
      ],
    };
  }

  return {
    segments: [
      ...state.segments,
      {
        start: obs.time,
        end: obs.time + hop,
        symbol: obs.candidate.symbol,
        root: obs.candidate.root,
        quality: obs.candidate.quality,
        confidence: obs.candidate.confidence,
        support: 1,
      },
    ],
  };
}

/** Segments a chord was heard for, ignoring how long until the next one. Pure. */
export function heardFor(segment: Segment): number {
  return segment.end - segment.start;
}

/**
 * Merge a second pass into a first. Where both passes cover the same moment,
 * the reading with more support wins; ties go to higher confidence.
 * Pure, associative in practice, and safe to run over any number of passes.
 */
export function mergePasses(a: readonly Segment[], b: readonly Segment[]): Segment[] {
  const all = [...a, ...b].sort((x, y) => x.start - y.start || x.end - y.end);
  const out: Segment[] = [];

  for (const seg of all) {
    const last = out[out.length - 1];

    if (!last || seg.start >= last.end) {
      out.push({ ...seg });
      continue;
    }

    // Two passes that agree always reinforce each other, whichever is
    // stronger -- that is the entire point of listening a second time.
    if (last.symbol === seg.symbol) {
      const support = last.support + seg.support;
      out[out.length - 1] = {
        ...last,
        end: Math.max(last.end, seg.end),
        support,
        confidence:
          (last.confidence * last.support + seg.confidence * seg.support) / support,
      };
      continue;
    }

    // They disagree about this moment, so the better-evidenced reading wins
    // and the loser gives up the overlapping span.
    const incumbentWins =
      last.support > seg.support ||
      (last.support === seg.support && last.confidence >= seg.confidence);

    if (incumbentWins) {
      if (seg.end > last.end) out.push({ ...seg, start: last.end });
    } else {
      out[out.length - 1] = { ...last, end: seg.start };
      out.push({ ...seg });
    }
  }

  return out.filter((s) => s.end > s.start);
}

/** Which chord is sounding at a given moment. Pure lookup. */
export function chordAt(segments: readonly Segment[], time: number): Segment | null {
  return segments.find((s) => time >= s.start && time < s.end) ?? null;
}

/** Chord change frequency, a rough proxy for harmonic rhythm. Pure. */
export function changesPerMinute(segments: readonly Segment[]): number {
  if (segments.length < 2) return 0;
  const span = segments[segments.length - 1].end - segments[0].start;
  return span > 0 ? (segments.length / span) * 60 : 0;
}

/** Count of each distinct chord, most common first. Pure. */
export function histogram(segments: readonly Segment[]): Array<{ symbol: string; count: number; seconds: number }> {
  const byChord = new Map<string, { count: number; seconds: number }>();
  for (const s of segments) {
    const prev = byChord.get(s.symbol) ?? { count: 0, seconds: 0 };
    byChord.set(s.symbol, {
      count: prev.count + 1,
      seconds: prev.seconds + (s.end - s.start),
    });
  }
  return [...byChord.entries()]
    .map(([symbol, v]) => ({ symbol, ...v }))
    .sort((x, y) => y.seconds - x.seconds);
}

/** The most common ordered run of n chords -- a song's actual loop. Pure. */
export function commonProgression(segments: readonly Segment[], n = 4): string[] {
  if (segments.length < n) return [];
  const counts = new Map<string, number>();
  for (let i = 0; i <= segments.length - n; i++) {
    const key = segments.slice(i, i + n).map((s) => s.symbol).join(' ');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0].split(' ') : [];
}
