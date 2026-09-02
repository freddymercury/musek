import { describe, it, expect } from 'vitest';
import { analyseBuffer } from '../analysis/offline';
import { prune, segmentsFrom } from '../analysis/timeline';
import { chord, progression } from '../theory/chords';
import { RATE, renderTrack, type TrackOptions } from './render';
import { score, pct } from './score';

/**
 * Parameter sweep for the harmonic leakage coefficient in the chord
 * templates. Guessing this number produced a 26-point accuracy regression;
 * measuring it is a loop over candidates.
 *
 * Not a pass/fail test so much as the record of how the value was chosen.
 */

const CONDITIONS: Array<{ name: string; opts: TrackOptions }> = [
  { name: 'clean', opts: {} },
  { name: 'bass', opts: { bass: true } },
  { name: 'mix', opts: { bass: true, inversion: 1, drumGain: 0.5, noiseGain: 0.03 } },
];

const LEAKS = [0, 0.02, 0.04, 0.06, 0.08, 0.12, 0.2, 0.35];

/**
 * A progression that genuinely uses sevenths. Without this the corpus
 * contains no seventh chords at all, and any sweep over the complexity
 * penalty happily drives it high enough to never predict one -- scoring
 * beautifully while making the analyser incapable of hearing a 7th.
 */
function jazzLoop(root: number) {
  return [
    chord(root + 2, 'min7'),   // ii7
    chord(root + 7, 'dom7'),   // V7
    chord(root, 'maj7'),       // Imaj7
    chord(root + 9, 'min7'),   // vi7
  ];
}

function measureSevenths(params: { penalty?: number; support?: number }): number {
  const keys = [60, 65, 69];
  const totals = keys.map((key) => {
    const chords = jazzLoop(key);
    const { samples, truth } = renderTrack(
      [...chords, ...chords].map((c) => ({ notes: c.notes, symbol: c.symbol })),
      { seconds: 1, bass: true },
    );
    const observations = analyseBuffer(samples, RATE, { hop: 0.05, ...params });
    return score(prune(segmentsFrom(observations, 0.05), 0.15), truth).recall;
  });
  return totals.reduce((a, b) => a + b, 0) / keys.length;
}

function measure(opts: TrackOptions, params: { leak?: number; gamma?: number; tuning?: number; penalty?: number; support?: number }): number {
  const keys = [60, 65, 69];
  const totals = keys.map((key) => {
    const chords = progression(key, ['I', 'V', 'vi', 'IV']);
    const { samples, truth } = renderTrack(
      [...chords, ...chords].map((c) => ({ notes: c.notes, symbol: c.symbol })),
      { seconds: 1, ...opts },
    );
    const observations = analyseBuffer(samples, RATE, { hop: 0.05, ...params });
    return score(prune(segmentsFrom(observations, 0.05), 0.15), truth).recall;
  });
  return totals.reduce((a, b) => a + b, 0) / keys.length;
}

describe('harmonic leak sweep', () => {
  it('finds the coefficient that maximises accuracy', () => {
    const rows: string[] = [];
    const means: Array<{ leak: number; mean: number }> = [];

    for (const leak of LEAKS) {
      const scores = CONDITIONS.map((c) => measure(c.opts, { leak }));
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      means.push({ leak, mean });
      rows.push(
        `  leak ${String(leak).padEnd(5)} ` +
        CONDITIONS.map((c, i) => `${c.name} ${pct(scores[i]).padStart(6)}`).join('  ') +
        `   mean ${pct(mean).padStart(6)}`,
      );
    }

    const best = means.reduce((a, b) => (b.mean > a.mean ? b : a));
    console.log(`\nHarmonic leak sweep:\n${rows.join('\n')}\n\n  best: ${best.leak} at ${pct(best.mean)}\n`);

    expect(means.length).toBe(LEAKS.length);
  }, 300_000);
});

describe('log compression sweep', () => {
  const GAMMAS = [0.25, 0.5, 1, 1.5, 2, 3, 5, 8];

  it('finds the compression strength that maximises accuracy', () => {
    const rows: string[] = [];
    const means: Array<{ gamma: number; mean: number }> = [];

    for (const gamma of GAMMAS) {
      const scores = CONDITIONS.map((c) => measure(c.opts, { gamma }));
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      means.push({ gamma, mean });
      rows.push(
        `  gamma ${String(gamma).padEnd(5)} ` +
        CONDITIONS.map((c, i) => `${c.name} ${pct(scores[i]).padStart(6)}`).join('  ') +
        `   mean ${pct(mean).padStart(6)}`,
      );
    }

    const best = means.reduce((a, b) => (b.mean > a.mean ? b : a));
    console.log(`\nLog compression sweep:\n${rows.join('\n')}\n\n  best: ${best.gamma} at ${pct(best.mean)}\n`);
    expect(means.length).toBe(GAMMAS.length);
  }, 300_000);
});

describe('is tuning estimation helping or hurting in-tune audio?', () => {
  it('compares estimated tuning against assuming A440', () => {
    const rows: string[] = [];
    for (const c of CONDITIONS) {
      const estimated = measure(c.opts, {});
      const assumed = measure(c.opts, { tuning: 0 });
      rows.push(`  ${c.name.padEnd(6)} estimated ${pct(estimated).padStart(6)}   assume A440 ${pct(assumed).padStart(6)}`);
    }
    const detuned: TrackOptions = { bass: true, tuning: Math.pow(2, 0.4 / 12) };
    rows.push(`  ${'detuned'.padEnd(6)} estimated ${pct(measure(detuned, {})).padStart(6)}   assume A440 ${pct(measure(detuned, { tuning: 0 })).padStart(6)}`);
    console.log(`\nTuning estimation:\n${rows.join('\n')}\n`);
    expect(rows.length).toBe(CONDITIONS.length + 1);
  }, 300_000);
});

describe('complexity penalty sweep', () => {
  const PENALTIES = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

  it('finds how much a seventh should have to earn its extra note', () => {
    const rows: string[] = [];
    const means: Array<{ penalty: number; triads: number; sevenths: number; mean: number }> = [];

    for (const support of PENALTIES) {
      const penalty = 0.25;
      const scores = CONDITIONS.map((c) => measure(c.opts, { support, penalty }));
      const triads = scores.reduce((a, b) => a + b, 0) / scores.length;
      const sevenths = measureSevenths({ support, penalty });
      // Both matter, so score on the worse of the two rather than the average.
      const mean = Math.min(triads, sevenths);
      means.push({ penalty: support, triads, sevenths, mean });
      rows.push(
        `  support ${String(support).padEnd(5)} ` +
        CONDITIONS.map((c, i) => `${c.name} ${pct(scores[i]).padStart(6)}`).join('  ') +
        `   7ths ${pct(sevenths).padStart(6)}   worst ${pct(mean).padStart(6)}`,
      );
    }

    const best = means.reduce((a, b) => (b.mean > a.mean ? b : a));
    console.log(`\nComplexity penalty sweep:\n${rows.join('\n')}\n\n  best: ${best.penalty}, triads ${pct(best.triads)}, sevenths ${pct(best.sevenths)}\n`);
    expect(means.length).toBe(PENALTIES.length);
  }, 300_000);
});
