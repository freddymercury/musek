import { chordAt, type Segment } from '../analysis/timeline';

/**
 * Scoring, using the metric the music-information-retrieval field uses for
 * chord recognition: chord symbol recall. Sample both the estimate and the
 * ground truth on a fine grid and count the fraction of time they agree.
 *
 * Duration-weighted rather than segment-counted on purpose -- getting a
 * four-bar chord right matters more than getting a passing one right.
 */

export interface Annotation {
  start: number;
  end: number;
  symbol: string;
}

export interface Score {
  /** Fraction of annotated time labelled exactly right. */
  recall: number;
  /** Fraction right when ignoring the chord's quality, root only. */
  rootRecall: number;
  /** Fraction of annotated time given no label at all. */
  missing: number;
  /** Most frequent wrong answers, worst first. */
  confusions: Array<{ expected: string; got: string; seconds: number }>;
}

const GRID = 0.01;
const NO_LABEL = 'none';

function truthAt(truth: readonly Annotation[], t: number): string | null {
  return truth.find((a) => t >= a.start && t < a.end)?.symbol ?? null;
}

/** Root is the leading letter plus any accidental. */
export function rootOf(symbol: string): string {
  const m = /^([A-G][#b]?)/.exec(symbol);
  return m ? m[1] : symbol;
}

export function score(estimate: readonly Segment[], truth: readonly Annotation[]): Score {
  if (!truth.length) return { recall: 0, rootRecall: 0, missing: 0, confusions: [] };

  const span = Math.max(...truth.map((a) => a.end));
  const confusion = new Map<string, number>();

  let total = 0;
  let exact = 0;
  let root = 0;
  let unlabelled = 0;

  for (let t = 0; t < span; t += GRID) {
    const want = truthAt(truth, t);
    if (want === null) continue;
    total++;

    const got = chordAt(estimate, t)?.symbol ?? null;

    if (got === null) {
      unlabelled++;
      const key = `${want}\t${NO_LABEL}`;
      confusion.set(key, (confusion.get(key) ?? 0) + GRID);
      continue;
    }

    if (got === want) {
      exact++;
      root++;
      continue;
    }

    if (rootOf(got) === rootOf(want)) root++;

    const key = `${want}\t${got}`;
    confusion.set(key, (confusion.get(key) ?? 0) + GRID);
  }

  return {
    recall: total ? exact / total : 0,
    rootRecall: total ? root / total : 0,
    missing: total ? unlabelled / total : 0,
    confusions: [...confusion.entries()]
      .map(([k, seconds]) => {
        const [expected, got] = k.split('\t');
        return { expected, got, seconds };
      })
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 5),
  };
}

export function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
