import { describe, it, expect } from 'vitest';
import { arrange, arrangementLength, fromPosition, notesOf, voice, CENTRE } from './arrange';
import { pitchClass } from '../theory/pitch';
import type { Segment } from './timeline';

const seg = (
  start: number, end: number, symbol: string, root: number,
  quality = 'maj', confidence = 0.9,
): Segment => ({ start, end, symbol, root, quality, confidence, support: 10 });

describe('voicing', () => {
  it('places a chord near the middle of the piano when nothing precedes it', () => {
    const notes = voice([0, 4, 7], null);
    const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
    expect(Math.abs(mean - CENTRE)).toBeLessThan(12);
  });

  it('keeps the right pitch classes', () => {
    expect(voice([0, 4, 7], null).map(pitchClass).sort((a, b) => a - b)).toEqual([0, 4, 7]);
  });

  it('moves as little as possible between chords', () => {
    const c = voice([0, 4, 7], null);
    const f = voice([5, 9, 0], c);
    const meanOf = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;
    // A root-position leap would move far more than an inversion does.
    expect(Math.abs(meanOf(f) - meanOf(c))).toBeLessThan(7);
  });

  it('does not drift out of range over a long progression', () => {
    let previous: number[] | null = null;
    for (let i = 0; i < 60; i++) {
      previous = voice([(i * 5) % 12, (i * 5 + 4) % 12, (i * 5 + 7) % 12], previous);
      for (const n of previous) {
        expect(n).toBeGreaterThanOrEqual(36);
        expect(n).toBeLessThanOrEqual(84);
      }
    }
  });

  it('returns notes in ascending order without duplicates', () => {
    const notes = voice([0, 0, 7, 7, 4], null);
    expect(notes).toEqual([...new Set(notes)].sort((a, b) => a - b));
  });

  it('handles a single note', () => {
    expect(voice([9], null)).toHaveLength(1);
  });

  it('is pure', () => {
    const previous = [60, 64, 67];
    const copy = [...previous];
    voice([2, 5, 9], previous);
    expect(previous).toEqual(copy);
  });
});

describe('notesOf', () => {
  it('builds the pitch classes of a quality', () => {
    expect(notesOf(0, 'maj').sort((a, b) => a - b)).toEqual([0, 4, 7]);
    expect(notesOf(9, 'min').sort((a, b) => a - b)).toEqual([0, 4, 9]);
  });

  it('falls back to a major triad for an unknown quality', () => {
    expect(notesOf(0, 'nonsense' as never).sort((a, b) => a - b)).toEqual([0, 4, 7]);
  });
});

describe('arrange', () => {
  const timeline = [
    seg(0, 2, 'C', 0),
    seg(2, 4, 'G', 7),
    seg(4, 6, 'Am', 9, 'min'),
    seg(6, 8, 'F', 5),
  ];

  it('produces one event per segment', () => {
    expect(arrange(timeline)).toHaveLength(4);
  });

  it('keeps each segment position and length', () => {
    const events = arrange(timeline);
    expect(events[0]).toMatchObject({ time: 0, duration: 2, symbol: 'C' });
    expect(events[2]).toMatchObject({ time: 4, duration: 2, symbol: 'Am' });
  });

  it('voices the chords smoothly across the progression', () => {
    const events = arrange(timeline);
    const mean = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;
    for (let i = 1; i < events.length; i++) {
      expect(Math.abs(mean(events[i].notes) - mean(events[i - 1].notes))).toBeLessThan(8);
    }
  });

  it('carries the root through for a bass voice', () => {
    expect(arrange(timeline).map((e) => e.root)).toEqual([0, 7, 9, 5]);
  });

  it('drops segments below the confidence floor', () => {
    const mixed = [seg(0, 2, 'C', 0, 'maj', 0.9), seg(2, 4, 'G', 7, 'maj', 0.3)];
    expect(arrange(mixed, { minConfidence: 0.5 }).map((e) => e.symbol)).toEqual(['C']);
  });

  it('drops segments shorter than the floor', () => {
    const mixed = [seg(0, 2, 'C', 0), seg(2, 2.1, 'G', 7)];
    expect(arrange(mixed, { minDuration: 0.5 }).map((e) => e.symbol)).toEqual(['C']);
  });

  it('handles an empty timeline', () => {
    expect(arrange([])).toEqual([]);
    expect(arrangementLength([])).toBe(0);
  });

  it('does not mutate the segments', () => {
    const copy = JSON.parse(JSON.stringify(timeline));
    arrange(timeline);
    expect(JSON.parse(JSON.stringify(timeline))).toEqual(copy);
  });

  it('is deterministic', () => {
    expect(arrange(timeline)).toEqual(arrange(timeline));
  });

  it('reports the length of the arrangement', () => {
    expect(arrangementLength(arrange(timeline))).toBe(8);
  });
});

describe('starting partway through', () => {
  const events = arrange([
    seg(0, 2, 'C', 0),
    seg(2, 4, 'G', 7),
    seg(4, 6, 'Am', 9, 'min'),
  ]);

  it('drops everything already finished', () => {
    expect(fromPosition(events, 4).map((e) => e.symbol)).toEqual(['Am']);
  });

  it('rebases so playback starts immediately', () => {
    expect(fromPosition(events, 4)[0].time).toBe(0);
  });

  it('keeps a chord already sounding, shortened', () => {
    const partial = fromPosition(events, 3);
    expect(partial[0].symbol).toBe('G');
    expect(partial[0].duration).toBe(1);
  });

  it('returns everything when starting at zero', () => {
    expect(fromPosition(events, 0)).toHaveLength(events.length);
  });

  it('returns nothing when starting past the end', () => {
    expect(fromPosition(events, 99)).toEqual([]);
  });

  it('never produces a negative time or duration', () => {
    for (const from of [0, 1.5, 3, 5.9]) {
      for (const e of fromPosition(events, from)) {
        expect(e.time).toBeGreaterThanOrEqual(0);
        expect(e.duration).toBeGreaterThan(0);
      }
    }
  });
});
