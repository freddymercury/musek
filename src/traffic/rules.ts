/**
 * The law, and what breaking it costs.
 *
 * Penalties are paid in seconds and added to the clock, which is the only way
 * a rule can matter in a game scored on time. The interesting question is how
 * much a second of speeding should cost, and there is a right answer.
 *
 * Cover distance `d` at `v` where the limit is `L`. You save
 *
 *     d/L - d/v = d(v - L) / (Lv)
 *
 * seconds. Charge the fine at a rate of `K(v - L)/L` seconds per second and
 * over that same distance you pay
 *
 *     K(v - L)/L * d/v = K * d(v - L) / (Lv)
 *
 * which is exactly K times what you saved. So with K > 1 speeding strictly
 * loses -- not on average, not usually, but for every speed, every distance
 * and every limit. `speedingNeverPays` in the tests is that statement.
 *
 * The rest are flat: running a red is twenty seconds because it is the one
 * violation that is also how you get somebody killed, and it should read as
 * the disaster it is even when the road is empty.
 */
export type ViolationKind = 'speeding' | 'red-light' | 'no-signal' | 'tailgating';

export interface Violation {
  kind: ViolationKind;
  /** Sim clock when the incident opened. */
  at: number;
  /** Metres along the route where it opened. */
  s: number;
  /** Penalty in seconds -- still growing while `open`. */
  seconds: number;
  note: string;
  open: boolean;
}

/**
 * Fine per second, as a multiple of the time speeding saves.
 *
 * Anything over 1 makes speeding lose on the open road, but a road with
 * lights on it has a second term the fine cannot see: hurry to a light and
 * you sometimes catch a green you would otherwise have sat at, which is worth
 * a whole cycle and costs nothing. Measured against the route, 1.5 left that
 * gamble roughly break-even. Three makes the fine bigger than the light.
 */
export const SPEEDING_K = 3;
/** Speedo slop, m/s. Under this you are not called a speeder, though the fine still accrues. */
export const SPEEDING_TOLERANCE = 2 / 3.6;
export const RED_LIGHT_PENALTY = 20;
export const NO_SIGNAL_PENALTY = 5;
/** Seconds of indicator owed to the drivers around you before you move across. */
export const SIGNAL_LEAD = 0.4;
/** The two-second rule, halved: below this you are on their bumper. */
export const TAILGATE_HEADWAY = 1.0;
/** Closing up for a moment is traffic. Staying there is tailgating. */
export const TAILGATE_GRACE = 1.5;
export const TAILGATE_RATE = 0.6;
/**
 * Below this speed you are in a queue, not tailgating. Bumper to bumper at
 * walking pace is what a jam *is* -- fining it would be fining the traffic.
 */
export const TAILGATE_MIN_SPEED = 5.5;

export const LABELS: Record<ViolationKind, string> = {
  speeding: 'Speeding',
  'red-light': 'Ran a red light',
  'no-signal': 'Lane change, no indicator',
  tailgating: 'Tailgating',
};

/** Penalty seconds per second of driving at `v` where the limit is `limit`. */
export function speedingRate(v: number, limit: number): number {
  return v <= limit ? 0 : (SPEEDING_K * (v - limit)) / limit;
}

export function isSpeeding(v: number, limit: number): boolean {
  return v > limit + SPEEDING_TOLERANCE;
}

/** Seconds of road between you and the car ahead at the current speed. */
export function headway(gap: number, v: number): number {
  return v <= TAILGATE_MIN_SPEED ? Infinity : gap / v;
}

/**
 * Add to the open incident of this kind, or open one. Continuous violations
 * read as a single ticket that grows rather than sixty tickets a second.
 */
export function accrue(
  list: Violation[],
  kind: ViolationKind,
  seconds: number,
  ctx: { t: number; s: number; note: string },
): Violation[] {
  // The open incident of this kind, wherever it sits. Looking only at the end
  // of the list means two violations running at once (speeding while sitting
  // on somebody's bumper) each append a fresh entry sixty times a second.
  const open = list.findLastIndex((v) => v.kind === kind && v.open);
  if (open >= 0) {
    const grown = { ...list[open], seconds: list[open].seconds + seconds, note: ctx.note };
    return list.map((v, i) => (i === open ? grown : v));
  }
  return [...list, { kind, at: ctx.t, s: ctx.s, seconds, note: ctx.note, open: true }];
}

/** Stop the meter on any open incident of this kind. */
export function closeOut(list: Violation[], kind: ViolationKind): Violation[] {
  if (!list.some((v) => v.open && v.kind === kind)) return list;
  return list.map((v) => (v.open && v.kind === kind ? { ...v, open: false } : v));
}

/** A one-off violation: its own entry, closed on arrival. */
export function once(
  list: Violation[],
  kind: ViolationKind,
  seconds: number,
  ctx: { t: number; s: number; note: string },
): Violation[] {
  return [...list, { kind, at: ctx.t, s: ctx.s, seconds, note: ctx.note, open: false }];
}

export function totalPenalty(list: Violation[]): number {
  return list.reduce((sum, v) => sum + v.seconds, 0);
}

export function countOf(list: Violation[], kind: ViolationKind): number {
  return list.filter((v) => v.kind === kind).length;
}

export type Medal = 'crashed' | 'gold' | 'silver' | 'bronze' | 'late';

export const MEDAL_TEXT: Record<Medal, string> = {
  crashed: 'You did not arrive',
  gold: 'In your seat for the overture',
  silver: 'In your seat, slightly out of breath',
  bronze: 'Seated during the first number',
  late: 'Held at the door until the interval',
};

/**
 * Clean and on time is the only gold: the brief was fast, no collision, law
 * abiding, and two out of three is silver.
 */
export function grade(run: { crashed: boolean; total: number; violations: Violation[]; par: number }): Medal {
  if (run.crashed) return 'crashed';
  if (run.total > run.par * 1.15) return 'late';
  if (run.total > run.par) return 'bronze';
  return run.violations.length === 0 ? 'gold' : 'silver';
}
