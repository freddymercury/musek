import type { Event } from '../analysis/arrange';
import { midiToFreq } from '../theory/pitch';
import { audioContext } from './synth';

/**
 * Plays an arrangement. Impure edge: it owns oscillators and a clock, and
 * makes no musical decisions -- arrange() already did those.
 *
 * Everything is scheduled against the AudioContext clock rather than
 * setTimeout, because timer jitter is audible as sloppy timing where
 * scheduled audio is sample accurate.
 */

export interface TransportOptions {
  /** Where in the arrangement to start, in seconds. */
  from?: number;
  gain?: number;
  /** Sound the root an octave below the voicing. */
  bass?: boolean;
  onPosition?: (seconds: number) => void;
  onEnd?: () => void;
}

export interface Transport {
  stop(): void;
  /** Position within the arrangement, in seconds. */
  position(): number;
}

function voiceAt(
  ac: AudioContext,
  out: GainNode,
  midi: number,
  start: number,
  duration: number,
  gain: number,
  wave: OscillatorType,
): void {
  const osc = ac.createOscillator();
  const env = ac.createGain();

  osc.type = wave;
  osc.frequency.value = midiToFreq(midi);

  // Ramps rather than steps: an abrupt gain change is itself a click.
  const hold = Math.max(0.08, duration * 0.9);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.linearRampToValueAtTime(gain, start + 0.02);
  env.gain.exponentialRampToValueAtTime(gain * 0.65, start + Math.min(0.25, hold * 0.4));
  env.gain.exponentialRampToValueAtTime(0.0001, start + hold);

  osc.connect(env).connect(out);
  osc.start(start);
  osc.stop(start + hold + 0.05);
}

/**
 * Schedule an arrangement and start playing. Returns a handle that can stop
 * it; there is no pause, because restarting from a position is the same call.
 */
export function play(events: readonly Event[], opts: TransportOptions = {}): Transport {
  const { from = 0, gain = 0.22, bass = true, onPosition, onEnd } = opts;

  const ac = audioContext();
  const master = ac.createGain();
  master.gain.value = 1;
  master.connect(ac.destination);

  /**
   * Where playback begins, in song time.
   *
   * Events are stamped in song time, so a capture that started two minutes
   * into a track has its first chord at t=120. Scheduling that at face value
   * meant waiting two minutes in silence -- the whole arrangement played,
   * just far in the future, with nothing to indicate anything was wrong.
   *
   * "From the start" therefore means the first chord we detected, not song
   * time zero. An explicit position is honoured as given.
   */
  const origin = from > 0
    ? from
    : events.reduce((min, e) => Math.min(min, e.time), Infinity);
  const start0 = isFinite(origin) ? origin : 0;

  const t0 = ac.currentTime + 0.08; // a beat of headroom to schedule into
  let last = 0;

  for (const e of events) {
    if (e.time + e.duration <= start0) continue;
    const start = t0 + Math.max(0, e.time - start0);

    const level = gain * (0.5 + 0.5 * Math.min(1, e.confidence));
    for (const note of e.notes) {
      voiceAt(ac, master, note, start, e.duration, level / Math.max(2, e.notes.length), 'triangle');
    }
    if (bass) {
      voiceAt(ac, master, e.root + 36, start, e.duration, level * 0.8, 'sine');
    }
    last = Math.max(last, e.time + e.duration - start0);
  }

  let stopped = false;
  const tick = setInterval(() => {
    if (stopped) return;
    const at = ac.currentTime - t0;
    onPosition?.(start0 + Math.max(0, at));
    if (at >= last) {
      stopped = true;
      clearInterval(tick);
      onEnd?.();
    }
  }, 60);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(tick);
      // Ramp the master down rather than cutting, which would click.
      master.gain.setValueAtTime(master.gain.value, ac.currentTime);
      master.gain.linearRampToValueAtTime(0.0001, ac.currentTime + 0.05);
      setTimeout(() => master.disconnect(), 120);
      onEnd?.();
    },
    position() {
      return start0 + Math.max(0, ac.currentTime - t0);
    },
  };
}
