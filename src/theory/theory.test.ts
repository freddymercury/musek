import { describe, it, expect } from 'vitest';
import {
  midiToFreq, freqToMidi, noteName, parseNote, pitchClass, centsOff, harmonics,
} from './pitch';
import { INTERVALS, consonance, PYTHAGOREAN_COMMA, interval } from './intervals';
import { SCALE_STEPS, scale, mode, modeSteps, stepsToOffsets, degree } from './scales';
import { chord, diatonicChords, qualityOf, identify, progression, tension, invert } from './chords';

describe('pitch', () => {
  it('anchors A4 at 440Hz', () => {
    expect(midiToFreq(69)).toBe(440);
    expect(midiToFreq(81)).toBeCloseTo(880);
    expect(midiToFreq(57)).toBeCloseTo(220);
  });

  it('round-trips midi and frequency', () => {
    for (const n of [21, 60, 69, 100, 108]) {
      expect(freqToMidi(midiToFreq(n))).toBeCloseTo(n);
    }
  });

  it('names middle C correctly', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(61)).toBe('C#4');
    expect(noteName(61, true)).toBe('Db4');
  });

  it('parses note names', () => {
    expect(parseNote('C4')).toBe(60);
    expect(parseNote('A4')).toBe(69);
    expect(parseNote('Bb3')).toBe(58);
    expect(parseNote('F#')).toBe(66);
  });

  it('measures detuning in cents', () => {
    expect(centsOff(440)).toBe(0);
    expect(centsOff(440 * Math.pow(2, 0.3 / 12))).toBe(30);
    expect(centsOff(440 * Math.pow(2, -0.25 / 12))).toBe(-25);
  });

  it('builds the harmonic series at integer multiples', () => {
    expect(harmonics(100, 4)).toEqual([100, 200, 300, 400]);
  });

  it('wraps pitch classes', () => {
    expect(pitchClass(60)).toBe(0);
    expect(pitchClass(-1)).toBe(11);
  });
});

describe('intervals', () => {
  it('keeps equal temperament within 20 cents of the just ratios', () => {
    for (const iv of INTERVALS) {
      expect(Math.abs(iv.temperamentError)).toBeLessThan(20);
    }
  });

  it('gets the perfect fifth nearly right -- about a tenth of a percent', () => {
    const fifth = INTERVALS[7];
    const tempered = Math.pow(2, 7 / 12);
    expect(Math.abs(tempered / 1.5 - 1)).toBeLessThan(0.002);
    expect(Math.abs(fifth.temperamentError)).toBeCloseTo(1.96, 1);
  });

  it('ranks simple ratios as more consonant', () => {
    expect(consonance(7)).toBeLessThan(consonance(6));  // fifth beats tritone
    expect(consonance(12)).toBeLessThan(consonance(1)); // octave beats semitone
  });

  it('shows the pythagorean comma overshooting seven octaves', () => {
    expect(PYTHAGOREAN_COMMA).toBeCloseTo(1.0136, 4);
  });

  it('treats the octave as distinct from the unison', () => {
    expect(interval(12).short).toBe('P8');
    expect(interval(0).short).toBe('P1');
  });
});

describe('scales', () => {
  it('has step patterns that sum to an octave', () => {
    for (const steps of Object.values(SCALE_STEPS)) {
      expect(steps.reduce((a, b) => a + b, 0)).toBe(12);
    }
  });

  it('builds C major on the white keys', () => {
    expect(scale(60, 'major')).toEqual([60, 62, 64, 65, 67, 69, 71]);
  });

  it('makes aeolian the natural minor', () => {
    expect(modeSteps('aeolian')).toEqual([...SCALE_STEPS.naturalMinor]);
  });

  it('makes ionian the major scale', () => {
    expect(modeSteps('ionian')).toEqual([...SCALE_STEPS.major]);
  });

  it('relates A aeolian to C major by shared notes', () => {
    const aMinor = mode(69, 'aeolian').map(pitchClass).sort((a, b) => a - b);
    const cMajor = scale(60, 'major').map(pitchClass).sort((a, b) => a - b);
    expect(aMinor).toEqual(cMajor);
  });

  it('wraps degrees into the next octave', () => {
    const c = scale(60, 'major');
    expect(degree(c, 7)).toBe(72);
    expect(degree(c, 0)).toBe(60);
  });

  it('starts offsets at zero', () => {
    expect(stepsToOffsets(SCALE_STEPS.major)).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });
});

describe('chords', () => {
  it('builds triads from the article intervals', () => {
    expect(chord(60, 'maj').notes).toEqual([60, 64, 67]);
    expect(chord(60, 'min').notes).toEqual([60, 63, 67]);
    expect(chord(60, 'dim').notes).toEqual([60, 63, 66]);
    expect(chord(60, 'aug').notes).toEqual([60, 64, 68]);
  });

  it('approximates 4:5:6 for a major triad', () => {
    const [r, third, fifth] = chord(60, 'maj').notes.map(midiToFreq);
    expect(third / r).toBeCloseTo(5 / 4, 1);
    expect(fifth / r).toBeCloseTo(6 / 4, 1);
  });

  it('names chords', () => {
    expect(chord(60, 'maj7').symbol).toBe('Cmaj7');
    expect(chord(62, 'min7').symbol).toBe('Dm7');
    expect(chord(67, 'dom7').symbol).toBe('G7');
  });

  it('identifies a quality from notes in any order or octave', () => {
    expect(qualityOf([60, 64, 67])).toBe('maj');
    expect(qualityOf([60, 67, 76])).toBe('maj');
    expect(qualityOf([60, 63, 67, 70])).toBe('min7');
  });

  it('preserves identity through inversions', () => {
    const c = chord(60, 'maj');
    expect(invert(c, 1).notes).toEqual([64, 67, 72]);
    expect(identify(invert(c, 2).notes)).toMatchObject({ root: 0, quality: 'maj' });
  });

  it('reads an ambiguous pitch-class set the way a musician would', () => {
    // {A,C,E} is Am before it is C6; {A,C,E,G} is Am7 before it is C6.
    expect(identify([69, 72, 76])).toMatchObject({ quality: 'min', symbol: 'Am' });
    expect(identify([69, 72, 76, 79])).toMatchObject({ quality: 'min7', symbol: 'Am7' });
  });

  it('identifies a chord from shuffled pitch classes', () => {
    expect(identify([7, 2, 11])).toMatchObject({ symbol: 'G' });
    expect(identify([64, 60, 67])).toMatchObject({ symbol: 'C' });
  });

  it('produces the I ii iii IV V vi vii-dim pattern in major', () => {
    expect(diatonicChords(60, 'major').map((c) => c.roman))
      .toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
  });

  it('produces i ii-dim III iv v VI VII in natural minor', () => {
    expect(diatonicChords(69, 'naturalMinor').map((c) => c.roman))
      .toEqual(['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']);
  });

  it('puts a dominant 7th on the fifth degree', () => {
    const v = diatonicChords(60, 'major', true)[4];
    expect(v.quality).toBe('dom7');
    expect(v.symbol).toBe('G7');
  });

  it('resolves numerals into a real progression', () => {
    expect(progression(60, ['vi', 'IV', 'I', 'V']).map((c) => c.symbol))
      .toEqual(['Am', 'F', 'C', 'G']);
  });

  it('transposes a progression by adding a constant', () => {
    const inC = progression(60, ['I', 'V', 'vi', 'IV']).map((c) => c.root);
    const inD = progression(62, ['I', 'V', 'vi', 'IV']).map((c) => c.root);
    expect(inD.map((n) => n - 2)).toEqual(inC);
  });

  it('scores the dominant 7th as more tense than the tonic', () => {
    expect(tension(chord(67, 'dom7').notes)).toBeGreaterThan(tension(chord(60, 'maj').notes));
  });

  it('finds the tritone inside the dominant 7th', () => {
    expect(tension(chord(67, 'dom7').notes)).toBeGreaterThanOrEqual(3);
  });
});
