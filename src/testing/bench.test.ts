import { describe, it, expect } from 'vitest';
import { analyseBuffer } from '../analysis/offline';
import { prune, segmentsFrom } from '../analysis/timeline';
import { diatonicChords, progression } from '../theory/chords';
import { RATE, renderTrack, type TrackOptions } from './render';
import { score, pct, type Score } from './score';

/**
 * Accuracy benchmark.
 *
 * The unit tests prove the analyser works on clean synthesised tones, which
 * is a much easier problem than real music. This measures how far accuracy
 * falls as the audio gets more realistic, one variable at a time, so a
 * regression shows up as a number rather than as a vague sense that captures
 * "seem off".
 *
 * These are still synthetic, so treat them as a floor and a tripwire, not as
 * a claim about real recordings. Real audio needs annotated songs.
 */

const POP = ['I', 'V', 'vi', 'IV'];

/** A four-chord loop, twice through, in a given key. */
function loop(root: number, numerals = POP) {
  const chords = progression(root, numerals);
  return [...chords, ...chords].map((c) => ({ notes: c.notes, symbol: c.symbol }));
}

interface Case {
  name: string;
  opts: TrackOptions;
}

const CASES: Case[] = [
  { name: 'clean triads', opts: {} },
  { name: '+ bass', opts: { bass: true } },
  { name: '+ inversions', opts: { bass: true, inversion: 1 } },
  { name: '+ light drums', opts: { bass: true, drumGain: 0.25 } },
  { name: '+ heavy drums', opts: { bass: true, drumGain: 0.7 } },
  { name: '+ hiss', opts: { bass: true, noiseGain: 0.04 } },
  { name: 'full mix', opts: { bass: true, inversion: 1, drumGain: 0.5, noiseGain: 0.03 } },
  { name: 'detuned 30c', opts: { bass: true, tuning: Math.pow(2, 0.3 / 12) } },
  { name: 'detuned 50c', opts: { bass: true, tuning: Math.pow(2, 0.5 / 12) } },
  { name: 'fast changes', opts: { bass: true, seconds: 0.5 } },
];

function run(opts: TrackOptions): Score {
  // Average over four keys so a result is not an accident of one root.
  const keys = [60, 62, 65, 69];
  const totals = keys.map((key) => {
    const { samples, truth } = renderTrack(loop(key), { seconds: 1, ...opts });
    const observations = analyseBuffer(samples, RATE, { hop: 0.05 });
    const segments = prune(segmentsFrom(observations, 0.05), 0.15);
    return score(segments, truth);
  });

  return {
    recall: totals.reduce((n, s) => n + s.recall, 0) / keys.length,
    rootRecall: totals.reduce((n, s) => n + s.rootRecall, 0) / keys.length,
    missing: totals.reduce((n, s) => n + s.missing, 0) / keys.length,
    confusions: totals.flatMap((s) => s.confusions)
      .sort((a, b) => b.seconds - a.seconds).slice(0, 5),
  };
}

describe('accuracy benchmark', () => {
  const results: Array<{ name: string; s: Score }> = [];

  for (const { name, opts } of CASES) {
    it(`measures: ${name}`, () => {
      const s = run(opts);
      results.push({ name, s });
      // Only a tripwire. The report below is the point.
      expect(s.recall).toBeGreaterThanOrEqual(0);
    });
  }

  it('reports the table', () => {
    const rows = results.map(({ name, s }) =>
      `  ${name.padEnd(16)} exact ${pct(s.recall).padStart(6)}   root ${pct(s.rootRecall).padStart(6)}   unlabelled ${pct(s.missing).padStart(6)}`);
    console.log(`\nChord symbol recall, 4 keys per row:\n${rows.join('\n')}\n`);

    const worst = results.filter((r) => r.s.recall < 0.5);
    if (worst.length) {
      console.log('Weakest conditions and what they get wrong instead:');
      for (const { name, s } of worst) {
        const top = s.confusions.slice(0, 3)
          .map((c) => `${c.expected}->${c.got}`).join(', ');
        console.log(`  ${name.padEnd(16)} ${top}`);
      }
      console.log('');
    }
    expect(results.length).toBe(CASES.length);
  });

  it('is at least right about the root on a clean signal', () => {
    expect(run({}).rootRecall).toBeGreaterThan(0.8);
  });

  it('does not silently collapse to labelling nothing', () => {
    expect(run({ bass: true, drumGain: 0.5 }).missing).toBeLessThan(0.5);
  });
});

describe('self-consistency checks', () => {
  /**
   * A cheap signal available without any ground truth: chords a song actually
   * uses should mostly be diatonic to the key it is in. Low agreement means
   * the reading is probably wrong, which is something the UI could surface.
   */
  it('finds a mostly diatonic reading of a diatonic progression', () => {
    const { samples, truth } = renderTrack(loop(60), { seconds: 1, bass: true });
    const segments = prune(segmentsFrom(analyseBuffer(samples, RATE, { hop: 0.05 }), 0.05), 0.15);

    const inKey = new Set(diatonicChords(60, 'major').map((c) => c.symbol));
    const agreeing = segments.filter((s) => inKey.has(s.symbol));
    const seconds = (xs: typeof segments) => xs.reduce((n, s) => n + (s.end - s.start), 0);

    const ratio = seconds(agreeing) / Math.max(0.001, seconds(segments));
    console.log(`\n  diatonic agreement: ${pct(ratio)} of labelled time\n`);
    expect(truth.length).toBeGreaterThan(0);
    expect(ratio).toBeGreaterThan(0.5);
  });
});
