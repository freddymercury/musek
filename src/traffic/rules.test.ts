import { describe, expect, test } from 'vitest';
import {
  NO_SIGNAL_PENALTY, RED_LIGHT_PENALTY, SPEEDING_K, TAILGATE_HEADWAY,
  accrue, closeOut, countOf, grade, headway, isSpeeding, once, speedingRate, totalPenalty,
  type Violation,
} from './rules';
import { fromKmh } from './cars';

describe('speeding', () => {
  test('is free at or under the limit', () => {
    const limit = fromKmh(50);
    expect(speedingRate(limit, limit)).toBe(0);
    expect(speedingRate(limit - 1, limit)).toBe(0);
    expect(speedingRate(limit + 1, limit)).toBeGreaterThan(0);
  });

  test('the speedo gets a couple of km/h of slop before it calls you a speeder', () => {
    const limit = fromKmh(50);
    expect(isSpeeding(fromKmh(51), limit)).toBe(false);
    expect(isSpeeding(fromKmh(54), limit)).toBe(true);
  });

  /**
   * The claim the whole scoring rests on: however far you go, however fast,
   * whatever the limit, the fine outruns the time it bought you.
   */
  test('never pays', () => {
    for (const limitKmh of [30, 40, 50, 60, 80, 100, 120]) {
      for (const overKmh of [1, 5, 10, 20, 40, 80]) {
        for (const distance of [50, 200, 1000, 5000]) {
          const limit = fromKmh(limitKmh);
          const v = limit + fromKmh(overKmh);
          const saved = distance / limit - distance / v;
          const fine = speedingRate(v, limit) * (distance / v);
          expect(fine).toBeGreaterThan(saved);
          expect(fine / saved).toBeCloseTo(SPEEDING_K, 6);
        }
      }
    }
  });
});

describe('the ledger', () => {
  const ctx = { t: 1, s: 10, note: 'over the limit' };

  test('a continuous violation is one growing ticket, not sixty a second', () => {
    let list = accrue([], 'speeding', 0.02, ctx);
    for (let i = 0; i < 99; i++) list = accrue(list, 'speeding', 0.02, ctx);
    expect(list).toHaveLength(1);
    expect(totalPenalty(list)).toBeCloseTo(2, 6);
  });

  test('closing one and reopening it makes a second ticket', () => {
    let list = accrue([], 'speeding', 1, ctx);
    list = closeOut(list, 'speeding');
    list = accrue(list, 'speeding', 1, ctx);
    expect(countOf(list, 'speeding')).toBe(2);
    expect(totalPenalty(list)).toBe(2);
  });

  test('one-off violations each stand alone', () => {
    let list = once([], 'red-light', RED_LIGHT_PENALTY, ctx);
    list = once(list, 'red-light', RED_LIGHT_PENALTY, ctx);
    expect(countOf(list, 'red-light')).toBe(2);
    expect(totalPenalty(list)).toBe(2 * RED_LIGHT_PENALTY);
  });

  test('accruing a different kind does not extend the open one', () => {
    let list = accrue([], 'speeding', 1, ctx);
    list = accrue(list, 'tailgating', 1, ctx);
    expect(list).toHaveLength(2);
  });

  test('two violations running at once stay two tickets, not two hundred', () => {
    let list: Violation[] = [];
    for (let i = 0; i < 300; i++) {
      list = accrue(list, 'speeding', 0.01, ctx);
      list = accrue(list, 'tailgating', 0.01, ctx);
    }
    expect(list).toHaveLength(2);
    expect(countOf(list, 'speeding')).toBe(1);
    expect(totalPenalty(list)).toBeCloseTo(6, 6);
  });
});

describe('headway', () => {
  test('is the seconds of road between you and the car ahead', () => {
    expect(headway(20, 10)).toBe(2);
    expect(headway(10, 10)).toBeLessThan(TAILGATE_HEADWAY + 0.01);
  });

  test('is not a thing when you are barely moving -- that is a queue', () => {
    expect(headway(1, 1)).toBe(Infinity);
  });
});

describe('grading', () => {
  const clean = { crashed: false, total: 200, violations: [], par: 240 };
  const ticket = once([], 'no-signal', NO_SIGNAL_PENALTY, { t: 0, s: 0, note: '' });

  test('gold is fast AND clean, not either', () => {
    expect(grade(clean)).toBe('gold');
    expect(grade({ ...clean, violations: ticket })).toBe('silver');
    expect(grade({ ...clean, total: 250 })).toBe('bronze');
    expect(grade({ ...clean, total: 400 })).toBe('late');
  });

  test('a collision outranks everything else about the run', () => {
    expect(grade({ ...clean, crashed: true })).toBe('crashed');
  });
});
