import { describe, it, expect, afterEach } from 'vitest';
import { arrange } from '../analysis/arrange';
import type { Segment } from '../analysis/timeline';
import { installFakeAudio, type FakeAudioContext } from '../testing/fakeAudio';
import { resetAudioContext } from './synth';
import { play } from './transport';

const seg = (start: number, end: number, symbol: string, root: number, quality = 'maj'): Segment =>
  ({ start, end, symbol, root, quality, confidence: 0.9, support: 10 });

let cleanup: (() => void) | null = null;

function withFakeAudio(): FakeAudioContext {
  resetAudioContext();
  const { ctx, restore } = installFakeAudio();
  cleanup = () => { restore(); resetAudioContext(); };
  return ctx;
}

afterEach(() => { cleanup?.(); cleanup = null; });

describe('transport scheduling', () => {
  it('makes sound at all', () => {
    const ctx = withFakeAudio();
    play(arrange([seg(0, 2, 'C', 0)]), { from: 0 });
    expect(ctx.oscillators.length).toBeGreaterThan(0);
  });

  it('routes every voice to the destination', () => {
    const ctx = withFakeAudio();
    play(arrange([seg(0, 2, 'C', 0)]), { from: 0 });
    for (const osc of ctx.oscillators) expect(osc.connectedToDestination).toBe(true);
  });

  it('gives every voice an audible gain', () => {
    const ctx = withFakeAudio();
    play(arrange([seg(0, 2, 'C', 0)]), { from: 0 });
    for (const osc of ctx.oscillators) expect(osc.peakGain).toBeGreaterThan(0.001);
  });

  it('starts the first chord almost immediately', () => {
    const ctx = withFakeAudio();
    play(arrange([seg(0, 2, 'C', 0), seg(2, 4, 'G', 7)]), { from: 0 });
    const first = Math.min(...ctx.oscillators.map((o) => o.startedAt));
    expect(first - ctx.currentTime).toBeLessThan(0.5);
  });

  it('starts immediately even when the song began far from zero', () => {
    // A capture that started two minutes into a track stamps its segments in
    // song time. Scheduling those at face value would wait two minutes.
    const ctx = withFakeAudio();
    play(arrange([seg(120, 122, 'C', 0), seg(122, 124, 'G', 7)]), { from: 0 });
    const first = Math.min(...ctx.oscillators.map((o) => o.startedAt));
    expect(first - ctx.currentTime).toBeLessThan(0.5);
  });

  it('keeps the gaps between chords intact', () => {
    const ctx = withFakeAudio();
    play(arrange([seg(100, 102, 'C', 0), seg(102, 104, 'G', 7)]), { from: 0 });
    const starts = [...new Set(ctx.oscillators.map((o) => Math.round(o.startedAt * 100) / 100))]
      .sort((a, b) => a - b);
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(starts[1] - starts[0]).toBeCloseTo(2, 1);
  });

  it('starts partway through when asked', () => {
    const ctx = withFakeAudio();
    const events = arrange([seg(0, 2, 'C', 0), seg(2, 4, 'G', 7), seg(4, 6, 'Am', 9, 'min')]);
    play(events, { from: 4 });
    // Only the Am remains: three chord voices, plus one bass.
    expect(ctx.oscillators.length).toBeLessThanOrEqual(4);
    const first = Math.min(...ctx.oscillators.map((o) => o.startedAt));
    expect(first - ctx.currentTime).toBeLessThan(0.5);
  });

  it('sounds a bass voice below the chord when asked', () => {
    const ctx = withFakeAudio();
    play(arrange([seg(0, 2, 'C', 0)]), { from: 0, bass: true });
    const lowest = Math.min(...ctx.oscillators.map((o) => o.frequency));
    expect(lowest).toBeLessThan(140); // C2 is about 65Hz
  });

  it('omits the bass when told to', () => {
    const withBass = withFakeAudio();
    play(arrange([seg(0, 2, 'C', 0)]), { from: 0, bass: true });
    const n = withBass.oscillators.length;
    cleanup?.(); cleanup = null;

    const without = withFakeAudio();
    play(arrange([seg(0, 2, 'C', 0)]), { from: 0, bass: false });
    expect(without.oscillators.length).toBe(n - 1);
  });

  it('stops every voice it starts', () => {
    const ctx = withFakeAudio();
    play(arrange([seg(0, 2, 'C', 0)]), { from: 0 });
    for (const osc of ctx.oscillators) expect(osc.stoppedAt).not.toBeNull();
  });

  it('plays notes at the frequencies of the chord it was given', () => {
    const ctx = withFakeAudio();
    play(arrange([seg(0, 2, 'C', 0)]), { from: 0, bass: false });
    // A C major triad, in any octave, is C E G and nothing else.
    const pcs = ctx.oscillators.map((o) => {
      const midi = Math.round(69 + 12 * Math.log2(o.frequency / 440));
      return ((midi % 12) + 12) % 12;
    });
    expect([...new Set(pcs)].sort((a, b) => a - b)).toEqual([0, 4, 7]);
  });

  it('handles an empty arrangement without scheduling anything', () => {
    const ctx = withFakeAudio();
    play([], { from: 0 });
    expect(ctx.oscillators).toHaveLength(0);
  });

  it('reports a position that advances with the clock', () => {
    const ctx = withFakeAudio();
    const t = play(arrange([seg(10, 20, 'C', 0)]), { from: 10 });
    const before = t.position();
    ctx.advance(2);
    expect(t.position()).toBeGreaterThan(before);
  });
});
