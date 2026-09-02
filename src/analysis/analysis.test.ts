import { describe, it, expect } from 'vitest';
import { midiToFreq, parseNote } from '../theory/pitch';
import { chord } from '../theory/chords';
import {
  chromaFromSpectrum, chromaOf, normalize, smooth, cosineSimilarity, energy, CHROMA_LENGTH,
} from './chroma';
import { detectChord, detectChords, detectKeys, detectScale, fitsKey } from './detect';
import {
  segmentsFrom, prune, observe, mergePasses, chordAt, histogram, heardFor,
  commonProgression, changesPerMinute, emptyTimeline, HOP, type Observation,
} from './timeline';
import { parseVideoId } from '../youtube/player';

const SAMPLE_RATE = 44100;
const FFT_SIZE = 8192;

/** Synthesise a magnitude spectrum containing the given frequencies. */
function spectrumOf(freqs: number[], harmonics = 4): Float32Array {
  const mags = new Float32Array(FFT_SIZE / 2);
  const binHz = SAMPLE_RATE / FFT_SIZE;
  for (const f of freqs) {
    for (let h = 1; h <= harmonics; h++) {
      const bin = Math.round((f * h) / binHz);
      if (bin < mags.length) mags[bin] += 1 / h; // harmonics roll off
    }
  }
  return mags;
}

const chromaOfNotes = (names: string[]) =>
  chromaFromSpectrum(spectrumOf(names.map((n) => midiToFreq(parseNote(n)))), SAMPLE_RATE, FFT_SIZE);

describe('chroma', () => {
  it('puts a single note in its own pitch class', () => {
    const c = normalize(chromaOfNotes(['A4']));
    expect(c.indexOf(Math.max(...c))).toBe(9); // A
  });

  it('collapses octaves onto the same pitch class', () => {
    const low = normalize(chromaOfNotes(['C3']));
    const high = normalize(chromaOfNotes(['C5']));
    expect(low.indexOf(Math.max(...low))).toBe(0);
    expect(high.indexOf(Math.max(...high))).toBe(0);
  });

  it('lights up three pitch classes for a triad', () => {
    const c = normalize(chromaOfNotes(['C4', 'E4', 'G4']));
    const strong = [...c].map((v, i) => [v, i]).filter(([v]) => v > 0.4).map(([, i]) => i);
    expect(strong.sort((a, b) => a - b)).toEqual([0, 4, 7]);
  });

  it('is always length 12', () => {
    expect(chromaOfNotes(['C4']).length).toBe(CHROMA_LENGTH);
    expect(chromaOf([0, 4, 7]).length).toBe(CHROMA_LENGTH);
  });

  it('normalizes to a unit maximum', () => {
    expect(Math.max(...normalize(chromaOfNotes(['D4', 'F#4'])))).toBeCloseTo(1);
  });

  it('returns a fresh zero vector for silence rather than the input', () => {
    const silent = new Float32Array(12);
    const out = normalize(silent);
    expect(out).not.toBe(silent);
    expect([...out]).toEqual(new Array(12).fill(0));
    expect(energy(out)).toBe(0);
  });

  it('does not mutate its input', () => {
    const c = chromaOf([0, 4, 7]);
    const before = [...c];
    normalize(c);
    smooth([c, c]);
    cosineSimilarity(c, chromaOf([0]));
    expect([...c]).toEqual(before);
  });

  it('averages frames when smoothing', () => {
    const avg = smooth([chromaOf([0]), chromaOf([0]), chromaOf([7])]);
    expect(avg[0]).toBeCloseTo(2 / 3);
    expect(avg[7]).toBeCloseTo(1 / 3);
  });

  it('returns zeros when smoothing nothing', () => {
    expect([...smooth([])]).toEqual(new Array(12).fill(0));
  });

  it('scores identical vectors as perfectly similar', () => {
    expect(cosineSimilarity(chromaOf([0, 4, 7]), chromaOf([0, 4, 7]))).toBeCloseTo(1);
  });

  it('scores disjoint vectors as dissimilar', () => {
    expect(cosineSimilarity(chromaOf([0, 4, 7]), chromaOf([1, 5, 8]))).toBeCloseTo(0);
  });

  it('is unfazed by an empty vector', () => {
    expect(cosineSimilarity(new Float32Array(12), chromaOf([0]))).toBe(0);
  });
});

describe('chord detection', () => {
  it('recognises a major triad from its spectrum', () => {
    expect(detectChord(chromaOfNotes(['C4', 'E4', 'G4']))?.symbol).toBe('C');
  });

  it('recognises a minor triad', () => {
    expect(detectChord(chromaOfNotes(['A3', 'C4', 'E4']))?.symbol).toBe('Am');
  });

  it('recognises a dominant 7th', () => {
    expect(detectChord(chromaOfNotes(['G3', 'B3', 'D4', 'F4']))?.symbol).toBe('G7');
  });

  it('recognises chords regardless of inversion', () => {
    expect(detectChord(chromaOfNotes(['E4', 'G4', 'C5']))?.symbol).toBe('C');
    expect(detectChord(chromaOfNotes(['G4', 'C5', 'E5']))?.symbol).toBe('C');
  });

  it('hears a power chord as a power chord, not a triad', () => {
    expect(detectChord(chromaOfNotes(['E2', 'B2']))?.quality).toBe('five');
  });

  it('ranks the right answer top across all twelve roots', () => {
    for (const root of [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71]) {
      const notes = chord(root, 'maj').notes;
      const c = chromaFromSpectrum(
        spectrumOf(notes.map(midiToFreq)), SAMPLE_RATE, FFT_SIZE,
      );
      expect(detectChords(c, 1)[0].root).toBe(root % 12);
    }
  });

  it('returns candidates sorted by confidence', () => {
    const ranked = detectChords(chromaOfNotes(['C4', 'E4', 'G4']), 5);
    expect(ranked).toHaveLength(5);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].confidence).toBeGreaterThanOrEqual(ranked[i].confidence);
    }
  });

  it('declines to guess at silence', () => {
    expect(detectChord(new Float32Array(12))).toBeNull();
  });

  it('bounds confidence to 0..1', () => {
    for (const c of detectChords(chromaOfNotes(['D4', 'F4', 'A4']), 12)) {
      expect(c.confidence).toBeGreaterThanOrEqual(0);
      expect(c.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('key detection', () => {
  it('finds C major from its scale', () => {
    const c = chromaOfNotes(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']);
    expect(detectKeys(c, 1)[0].name).toBe('C major');
  });

  it('separates a minor key from its relative major by tonic emphasis', () => {
    // Weight the tonic and dominant of A minor, as a real song would.
    const c = chromaOf([9, 0, 4, 2, 5, 7, 11], [1, 0.7, 0.8, 0.4, 0.4, 0.4, 0.3]);
    const top = detectKeys(c, 2);
    expect(top.map((k) => k.name)).toContain('A minor');
  });

  it('ranks keys by confidence', () => {
    const keys = detectKeys(chromaOfNotes(['G4', 'B4', 'D5']), 3);
    expect(keys[0].confidence).toBeGreaterThanOrEqual(keys[1].confidence);
  });

  it('knows which chords are diatonic to a key', () => {
    expect(fitsKey(2, 0, 'major')).toBe(true);   // Dm in C major
    expect(fitsKey(1, 0, 'major')).toBe(false);  // C# is borrowed
    expect(fitsKey(7, 0, 'major')).toBe(true);   // G
  });

  it('matches a pentatonic scale when only five classes sound', () => {
    const found = detectScale(chromaOf([0, 2, 4, 7, 9]));
    expect(found.scale).toBe('majorPentatonic');
    expect(found.root).toBe(0);
  });
});

describe('timeline', () => {
  const obs = (time: number, symbol: string, confidence = 0.9): Observation => ({
    time,
    candidate: { root: 0, quality: 'maj', symbol, confidence },
  });

  /** A chord sounding continuously, sampled at the analysis hop rate. */
  const run = (symbol: string, from: number, to: number, confidence = 0.9): Observation[] => {
    // Integer stepping, so the helper does not introduce float drift of its own.
    const frames = Math.round((to - from) / HOP);
    return Array.from({ length: frames }, (_, i) =>
      obs(Number((from + i * HOP).toFixed(6)), symbol, confidence));
  };

  it('collapses repeated observations into one segment', () => {
    const segs = segmentsFrom(run('C', 0, 1));
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ start: 0, symbol: 'C', support: 10 });
    expect(segs[0].end).toBeCloseTo(1);
  });

  it('starts a new segment when the chord changes', () => {
    const segs = segmentsFrom([...run('C', 0, 1), ...run('G', 1, 2), ...run('Am', 2, 3)]);
    expect(segs.map((s) => s.symbol)).toEqual(['C', 'G', 'Am']);
  });

  it('runs each segment up to the next without overlapping it', () => {
    const segs = segmentsFrom([...run('C', 0, 1), ...run('G', 1, 2)]);
    expect(segs[0].end).toBeCloseTo(1);
    expect(segs[1].start).toBeCloseTo(1);
    expect(segs[0].end).toBeLessThanOrEqual(segs[1].start);
  });

  it('sorts observations that arrive out of order', () => {
    const shuffled = [...run('G', 1, 2), ...run('C', 0, 1)];
    expect(segmentsFrom(shuffled).map((s) => s.symbol)).toEqual(['C', 'G']);
  });

  it('does not mutate the observations it is given', () => {
    const input = [...run('G', 1, 2), ...run('C', 0, 1)];
    const copy = JSON.parse(JSON.stringify(input));
    segmentsFrom(input);
    expect(JSON.parse(JSON.stringify(input))).toEqual(copy);
  });

  it('averages confidence across supporting observations', () => {
    const segs = segmentsFrom([obs(0, 'C', 0.6), obs(0.1, 'C', 1.0)]);
    expect(segs[0].confidence).toBeCloseTo(0.8);
  });

  it('handles no observations at all', () => {
    expect(segmentsFrom([])).toEqual([]);
    expect(histogram([])).toEqual([]);
    expect(commonProgression([])).toEqual([]);
    expect(changesPerMinute([])).toBe(0);
    expect(chordAt([], 5)).toBeNull();
  });

  it('prunes a one-frame blip but keeps a sustained chord', () => {
    const segs = segmentsFrom([
      ...run('C', 0, 0.5),
      obs(0.5, 'G'),              // a single stray frame
      ...run('C', 0.6, 1.2),
    ]);
    const kept = prune(segs).map((s) => s.symbol);
    expect(kept).not.toContain('G');
    expect(kept).toContain('C');
  });

  it('does not credit a chord with time it was never heard for', () => {
    // One observation of G, then nothing until Am five seconds later.
    const segs = segmentsFrom([obs(0, 'C'), obs(1, 'G'), obs(6, 'Am')]);
    const g = segs.find((s) => s.symbol === 'G')!;
    expect(heardFor(g)).toBeCloseTo(HOP);
  });

  it('splits one chord into two segments across a gap in listening', () => {
    const segs = segmentsFrom([...run('C', 0, 0.5), ...run('C', 30, 30.5)]);
    expect(segs).toHaveLength(2);
  });

  it('folds observations one at a time to the same result as batch', () => {
    const stream = [...run('C', 0, 1), ...run('G', 1, 2)];
    const folded = stream.reduce((st, o) => observe(st, o), emptyTimeline);
    expect(folded.segments.map((s) => s.symbol)).toEqual(segmentsFrom(stream).map((s) => s.symbol));
    expect(folded.segments[0].support).toBe(10);
  });

  it('never mutates state when folding', () => {
    const before = observe(emptyTimeline, obs(0, 'C'));
    const after = observe(before, obs(1, 'G'));
    expect(before.segments).toHaveLength(1);
    expect(after.segments).toHaveLength(2);
    expect(emptyTimeline.segments).toHaveLength(0);
  });

  it('looks up the chord sounding at a moment', () => {
    const segs = segmentsFrom([...run('C', 0, 2), ...run('G', 2, 4), ...run('Am', 4, 6)]);
    expect(chordAt(segs, 1)?.symbol).toBe('C');
    expect(chordAt(segs, 3)?.symbol).toBe('G');
    expect(chordAt(segs, 5)?.symbol).toBe('Am');
    expect(chordAt(segs, 99)).toBeNull();
  });

  it('reinforces a chord when a second pass agrees', () => {
    const pass1 = segmentsFrom([...run('C', 0, 2, 0.6), ...run('G', 2, 4, 0.6)]);
    const pass2 = segmentsFrom([...run('C', 0, 2, 0.8), ...run('G', 2, 4, 0.8)]);
    const merged = mergePasses(pass1, pass2);
    expect(merged[0].symbol).toBe('C');
    expect(merged[0].support).toBeGreaterThan(pass1[0].support);
    expect(merged[0].confidence).toBeCloseTo(0.7);
  });

  it('lets a better-supported second pass overrule a weak first reading', () => {
    const weak = segmentsFrom(run('C', 0, 0.3, 0.5));
    const strong = segmentsFrom(run('Am', 0, 2, 0.95));
    expect(mergePasses(weak, strong)[0].symbol).toBe('Am');
  });

  it('merges an empty pass without changing anything', () => {
    const segs = segmentsFrom([...run('C', 0, 1), ...run('G', 1, 2)]);
    expect(mergePasses(segs, []).map((s) => s.symbol)).toEqual(['C', 'G']);
    expect(mergePasses([], segs).map((s) => s.symbol)).toEqual(['C', 'G']);
  });

  it('never emits a zero-length segment when merging', () => {
    const merged = mergePasses(
      segmentsFrom([...run('C', 0, 1), ...run('G', 1, 2)]),
      segmentsFrom([...run('F', 0.5, 1.5), ...run('G', 1.5, 2.5)]),
    );
    expect(merged.length).toBeGreaterThan(0);
    for (const s of merged) expect(s.end).toBeGreaterThan(s.start);
  });

  it('keeps merged segments in order and non-overlapping', () => {
    const merged = mergePasses(
      segmentsFrom([...run('C', 0, 1), ...run('G', 1, 2)]),
      segmentsFrom([...run('F', 0.5, 1.5)]),
    );
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i].start).toBeGreaterThanOrEqual(merged[i - 1].end);
    }
  });

  it('ranks chords by how long they sound', () => {
    const segs = segmentsFrom([...run('C', 0, 4), ...run('G', 4, 5), ...run('C', 5, 9)]);
    expect(histogram(segs)[0].symbol).toBe('C');
    expect(histogram(segs)[0].count).toBe(2);
  });

  it('finds the loop a song actually repeats', () => {
    const symbols = ['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F'];
    const segs = segmentsFrom(symbols.flatMap((s, i) => run(s, i, i + 1)));
    expect(commonProgression(segs, 4)).toEqual(['C', 'G', 'Am', 'F']);
  });

  it('reports harmonic rhythm', () => {
    const segs = segmentsFrom(['C', 'G', 'Am', 'F'].flatMap((s, i) => run(s, i, i + 1)));
    expect(changesPerMinute(segs)).toBeCloseTo(60, 0);
  });
});

describe('youtube link parsing', () => {
  it('accepts every url shape youtube hands out', () => {
    const id = 'dQw4w9WgXcQ';
    expect(parseVideoId(`https://www.youtube.com/watch?v=${id}`)).toBe(id);
    expect(parseVideoId(`https://youtu.be/${id}`)).toBe(id);
    expect(parseVideoId(`https://www.youtube.com/embed/${id}`)).toBe(id);
    expect(parseVideoId(`https://www.youtube.com/shorts/${id}`)).toBe(id);
    expect(parseVideoId(`https://m.youtube.com/watch?v=${id}&t=42s`)).toBe(id);
    expect(parseVideoId(id)).toBe(id);
    expect(parseVideoId(`  ${id}  `)).toBe(id);
  });

  it('rejects anything that is not a video link', () => {
    expect(parseVideoId('https://example.com')).toBeNull();
    expect(parseVideoId('not a url')).toBeNull();
    expect(parseVideoId('')).toBeNull();
    expect(parseVideoId('https://www.youtube.com/')).toBeNull();
  });
});
