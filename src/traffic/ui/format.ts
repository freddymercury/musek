/** Stopwatch time: minutes, seconds and the tenth that decides the medal. */
export function clock(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const s = Math.abs(seconds);
  return `${sign}${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

/** Whole seconds, for a duration that is a plan rather than a measurement. */
export function minutes(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}
