import { describe, it, expect } from 'vitest';
import { planFFT, magnitudeSpectrum } from './fft';
import { analyseBuffer, toMono } from './offline';
import { segmentsFrom, prune } from './timeline';
import {
  emptyTimeMap, identityTimeMap, anchor, toSongTime, toRecordingTime,
} from './timemap';
import { midiToFreq, parseNote } from '../theory/pitch';
import { chord } from '../theory/chords';

const RATE = 44100;

/** Synthesise a tone with a few harmonics, as a real instrument has. */
function tone(freq: number, seconds: number, rate = RATE): Float32Array {
  const out = new Float32Array(Math.floor(seconds * rate));
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    out[i] =
      0.6 * Math.sin(2 * Math.PI * freq * t) +
      0.25 * Math.sin(2 * Math.PI * freq * 2 * t) +
      0.1 * Math.sin(2 * Math.PI * freq * 3 * t);
  }
  return out;
}

function mix(parts: Float32Array[]): Float32Array {
  const length = Math.max(...parts.map((p) => p.length));
  const out = new Float32Array(length);
  for (const p of parts) for (let i = 0; i < p.length; i++) out[i] += p[i] / parts.length;
  return out;
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const notes = (names: string[], seconds: number) =>
  mix(names.map((n) => tone(midiToFreq(parseNote(n)), seconds)));

describe('fft', () => {
  it('rejects sizes that are not a power of two', () => {
    expect(() => planFFT(1000)).toThrow(/power of two/);
    expect(() => planFFT(1024)).not.toThrow();
  });

  it('puts a pure sine in the bin matching its frequency', () => {
    const size = 4096;
    const plan = planFFT(size);
    const freq = (RATE / size) * 100; // exactly bin 100
    const samples = new Float32Array(size);
    for (let i = 0; i < size; i++) samples[i] = Math.sin((2 * Math.PI * freq * i) / RATE);

    const mags = magnitudeSpectrum(samples, plan);
    let peak = 0;
    for (let i = 1; i < mags.length; i++) if (mags[i] > mags[peak]) peak = i;
    expect(peak).toBe(100);
  });

  it('returns size/2 bins', () => {
    expect(magnitudeSpectrum(new Float32Array(2048), planFFT(2048)).length).toBe(1024);
  });

  it('reports silence as silence', () => {
    const mags = magnitudeSpectrum(new Float32Array(1024), planFFT(1024));
    expect(Math.max(...mags)).toBe(0);
  });

  it('resolves two simultaneous tones as two peaks', () => {
    const size = 8192;
    const plan = planFFT(size);
    const a = 440, b = 660;
    const samples = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      samples[i] = Math.sin((2 * Math.PI * a * i) / RATE) + Math.sin((2 * Math.PI * b * i) / RATE);
    }
    const mags = magnitudeSpectrum(samples, plan);
    const binOf = (f: number) => Math.round(f / (RATE / size));
    const near = (bin: number) => Math.max(...Array.from({ length: 5 }, (_, k) => mags[bin - 2 + k]));
    const floor = mags[binOf(1500)];
    expect(near(binOf(a))).toBeGreaterThan(floor * 10);
    expect(near(binOf(b))).toBeGreaterThan(floor * 10);
  });

  it('does not modify its input', () => {
    const samples = tone(440, 0.2).subarray(0, 1024);
    const before = [...samples];
    magnitudeSpectrum(samples, planFFT(1024));
    expect([...samples]).toEqual(before);
  });

  it('writes into a caller-supplied buffer when given one', () => {
    const out = new Float32Array(512);
    const result = magnitudeSpectrum(tone(440, 0.1), planFFT(1024), out);
    expect(result).toBe(out);
  });

  it('gives the same answer every run', () => {
    const plan = planFFT(2048);
    const samples = tone(440, 0.1);
    expect([...magnitudeSpectrum(samples, plan)]).toEqual([...magnitudeSpectrum(samples, plan)]);
  });
});

describe('offline analysis', () => {
  it('hears a sustained major triad', () => {
    const obs = analyseBuffer(notes(['C4', 'E4', 'G4'], 2), RATE);
    expect(obs.length).toBeGreaterThan(0);
    const segs = prune(segmentsFrom(obs));
    expect(segs[0].symbol).toBe('C');
  });

  it('hears a minor triad', () => {
    const segs = prune(segmentsFrom(analyseBuffer(notes(['A3', 'C4', 'E4'], 2), RATE)));
    expect(segs[0].symbol).toBe('Am');
  });

  it('follows a chord change through a recording', () => {
    const audio = concat([
      notes(['C4', 'E4', 'G4'], 1.5),
      notes(['G3', 'B3', 'D4'], 1.5),
      notes(['A3', 'C4', 'E4'], 1.5),
    ]);
    const segs = prune(segmentsFrom(analyseBuffer(audio, RATE)));
    expect(segs.map((s) => s.symbol)).toEqual(['C', 'G', 'Am']);
  });

  it('stamps observations across the whole recording', () => {
    const obs = analyseBuffer(notes(['C4', 'E4', 'G4'], 3), RATE);
    expect(obs[0].time).toBeLessThan(0.5);
    expect(obs[obs.length - 1].time).toBeGreaterThan(2);
  });

  it('stays quiet through silence', () => {
    expect(analyseBuffer(new Float32Array(RATE * 2), RATE)).toEqual([]);
  });

  it('handles a recording shorter than one frame', () => {
    expect(analyseBuffer(new Float32Array(100), RATE)).toEqual([]);
  });

  it('is deterministic', () => {
    const audio = notes(['D4', 'F#4', 'A4'], 1.5);
    const a = analyseBuffer(audio, RATE).map((o) => o.candidate.symbol);
    const b = analyseBuffer(audio, RATE).map((o) => o.candidate.symbol);
    expect(a).toEqual(b);
  });

  it('does not modify the samples it is given', () => {
    const audio = notes(['C4', 'E4', 'G4'], 0.5);
    const before = [...audio];
    analyseBuffer(audio, RATE);
    expect([...audio]).toEqual(before);
  });

  it('resolves more detail at a finer hop', () => {
    const audio = notes(['C4', 'E4', 'G4'], 2);
    const coarse = analyseBuffer(audio, RATE, { hop: 0.4 });
    const fine = analyseBuffer(audio, RATE, { hop: 0.05 });
    expect(fine.length).toBeGreaterThan(coarse.length);
  });

  it('restamps observations into song time when asked', () => {
    const obs = analyseBuffer(notes(['C4', 'E4', 'G4'], 1), RATE, {
      toSongTime: (t) => t + 100,
    });
    expect(obs[0].time).toBeGreaterThanOrEqual(100);
  });

  it('recognises every major triad played in sequence', () => {
    for (const root of [60, 63, 66, 69]) {
      const audio = mix(chord(root, 'maj').notes.map((n) => tone(midiToFreq(n), 1.5)));
      const segs = prune(segmentsFrom(analyseBuffer(audio, RATE)));
      expect(segs[0].root).toBe(root % 12);
    }
  });

  it('averages channels to mono', () => {
    const left = Float32Array.from([1, 1, 1]);
    const right = Float32Array.from([0, 0, 0]);
    expect([...toMono([left, right])]).toEqual([0.5, 0.5, 0.5]);
  });

  it('passes a mono recording through untouched', () => {
    const mono = Float32Array.from([0.1, 0.2]);
    expect(toMono([mono])).toBe(mono);
  });

  it('truncates to the shortest channel rather than reading past the end', () => {
    expect(toMono([Float32Array.from([1, 1, 1]), Float32Array.from([1, 1])]).length).toBe(2);
  });
});

describe('time mapping', () => {
  it('treats a recording with no song as its own clock', () => {
    expect(toSongTime(identityTimeMap, 12.5)).toBeCloseTo(12.5);
  });

  it('falls back to recording time with no anchors at all', () => {
    expect(toSongTime(emptyTimeMap, 7)).toBe(7);
  });

  it('offsets when capture started partway into a song', () => {
    const map = anchor(emptyTimeMap, { recording: 0, song: 60 });
    expect(toSongTime(map, 10)).toBeCloseTo(70);
  });

  it('interpolates between anchors during normal playback', () => {
    const map = [
      { recording: 0, song: 30 },
      { recording: 10, song: 40 },
    ].reduce(anchor, emptyTimeMap);
    expect(toSongTime(map, 5)).toBeCloseTo(35);
  });

  it('keeps anchors ordered however they arrive', () => {
    const map = [
      { recording: 10, song: 40 },
      { recording: 0, song: 30 },
    ].reduce(anchor, emptyTimeMap);
    expect(map.anchors.map((a) => a.recording)).toEqual([0, 10]);
  });

  it('does not invent positions across a mid-capture seek', () => {
    // Listener jumped back to the chorus: song time leapt while recording crawled.
    const map = [
      { recording: 0, song: 100 },
      { recording: 0.5, song: 20 },
      { recording: 10, song: 29.5 },
    ].reduce(anchor, emptyTimeMap);
    expect(toSongTime(map, 0.25)).toBeCloseTo(100);
    expect(toSongTime(map, 5)).toBeGreaterThan(20);
    expect(toSongTime(map, 5)).toBeLessThan(30);
  });

  it('holds position through a pause', () => {
    const map = [
      { recording: 0, song: 10 },
      { recording: 5, song: 10 },   // paused: song time did not move
      { recording: 10, song: 15 },
    ].reduce(anchor, emptyTimeMap);
    expect(toSongTime(map, 3)).toBeCloseTo(10);
  });

  it('extrapolates past the last anchor', () => {
    const map = anchor(emptyTimeMap, { recording: 0, song: 5 });
    expect(toSongTime(map, 100)).toBeCloseTo(105);
  });

  it('never mutates the map it is given', () => {
    const map = anchor(emptyTimeMap, { recording: 0, song: 0 });
    anchor(map, { recording: 1, song: 1 });
    expect(map.anchors).toHaveLength(1);
    expect(emptyTimeMap.anchors).toHaveLength(0);
  });

  it('inverts back to recording time', () => {
    const map = [
      { recording: 0, song: 30 },
      { recording: 10, song: 40 },
    ].reduce(anchor, emptyTimeMap);
    expect(toRecordingTime(map, 35)).toBeCloseTo(5);
  });

  it('round-trips a position through both directions', () => {
    const map = [
      { recording: 0, song: 12 },
      { recording: 20, song: 32 },
    ].reduce(anchor, emptyTimeMap);
    const rec = toRecordingTime(map, 25)!;
    expect(toSongTime(map, rec)).toBeCloseTo(25);
  });

  it('reports that a song position was never captured', () => {
    const map = [
      { recording: 0, song: 60 },
      { recording: 10, song: 70 },
    ].reduce(anchor, emptyTimeMap);
    expect(toRecordingTime(map, 5)).toBeNull();
  });
});
