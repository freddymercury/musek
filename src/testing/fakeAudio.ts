/**
 * A recording stand-in for Web Audio.
 *
 * Playback bugs are otherwise invisible to tests: the transport reports no
 * error whether it schedules a chord one beat away or two minutes away, and
 * both look identical from the outside. This captures every node and every
 * scheduled time so the arithmetic can be asserted.
 */

export interface ScheduledOscillator {
  type: string;
  frequency: number;
  startedAt: number;
  stoppedAt: number | null;
  /** Peak gain of the envelope this oscillator was connected through. */
  peakGain: number;
  connectedToDestination: boolean;
}

export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  state: 'running' | 'suspended' | 'closed' = 'running';
  destination = { kind: 'destination' };

  readonly oscillators: ScheduledOscillator[] = [];

  createOscillator() {
    const ctx = this;
    const record: ScheduledOscillator = {
      type: 'sine',
      frequency: 0,
      startedAt: NaN,
      stoppedAt: null,
      peakGain: 0,
      connectedToDestination: false,
    };

    const osc = {
      _record: record,
      set type(v: string) { record.type = v; },
      get type() { return record.type; },
      frequency: {
        set value(v: number) { record.frequency = v; },
        get value() { return record.frequency; },
      },
      connect(target: { _sink?: () => void; _peak?: () => number; _dest?: boolean }) {
        // Track the gain node this oscillator feeds, and where that leads.
        (record as { _via?: unknown })._via = target;
        return target;
      },
      start(t: number) {
        record.startedAt = t;
        ctx.oscillators.push(record);
      },
      stop(t: number) { record.stoppedAt = t; },
    };

    // Resolve envelope peak and routing lazily at start(), via the gain chain.
    const origStart = osc.start.bind(osc);
    osc.start = (t: number) => {
      const via = (record as { _via?: FakeGainNode })._via;
      if (via) {
        record.peakGain = via.peak();
        record.connectedToDestination = via.reachesDestination();
      }
      origStart(t);
    };

    return osc as unknown as OscillatorNode;
  }

  createGain() {
    return new FakeGainNode() as unknown as GainNode;
  }

  createAnalyser() {
    return {
      fftSize: 2048,
      frequencyBinCount: 1024,
      smoothingTimeConstant: 0,
      getFloatFrequencyData: () => {},
    } as unknown as AnalyserNode;
  }

  createMediaStreamSource() {
    return { connect: () => {}, disconnect: () => {} } as unknown as MediaStreamAudioSourceNode;
  }

  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }

  /** Advance the clock, as time passing would. */
  advance(seconds: number) { this.currentTime += seconds; }
}

class FakeGainNode {
  private target: FakeGainNode | { kind: string } | null = null;
  private peakValue = 0;
  private disconnected = false;

  readonly gain = {
    _peak: 0,
    _self: this as FakeGainNode,
    set value(v: number) { this._peak = Math.max(this._peak, v); this._self.note(v); },
    get value() { return this._peak; },
    setValueAtTime: (v: number) => { this.note(v); return this.gain; },
    linearRampToValueAtTime: (v: number) => { this.note(v); return this.gain; },
    exponentialRampToValueAtTime: (v: number) => { this.note(v); return this.gain; },
    cancelScheduledValues: () => this.gain,
  };

  constructor() {
    this.gain._self = this;
  }

  private note(v: number) {
    if (v > this.peakValue) this.peakValue = v;
  }

  connect(target: FakeGainNode | { kind: string }) {
    this.target = target;
    return target;
  }

  disconnect() { this.disconnected = true; }

  peak(): number {
    // An oscillator's audible level is its own envelope times everything after.
    const downstream = this.target instanceof FakeGainNode ? this.target.peak() : 1;
    return this.peakValue * downstream;
  }

  reachesDestination(): boolean {
    if (this.disconnected) return false;
    if (this.target instanceof FakeGainNode) return this.target.reachesDestination();
    return !!this.target && (this.target as { kind?: string }).kind === 'destination';
  }
}

/** Install the fake as the global AudioContext, returning a cleanup function. */
export function installFakeAudio(): { ctx: FakeAudioContext; restore: () => void } {
  const ctx = new FakeAudioContext();
  const previous = (globalThis as { AudioContext?: unknown }).AudioContext;
  (globalThis as { AudioContext?: unknown }).AudioContext = function () {
    return ctx;
  } as unknown as typeof AudioContext;

  const previousInterval = globalThis.setInterval;
  const previousClear = globalThis.clearInterval;
  // The transport's position ticker is irrelevant here and would leak timers.
  (globalThis as { setInterval: unknown }).setInterval = () => 0 as unknown as number;
  (globalThis as { clearInterval: unknown }).clearInterval = () => {};

  return {
    ctx,
    restore() {
      (globalThis as { AudioContext?: unknown }).AudioContext = previous;
      globalThis.setInterval = previousInterval;
      globalThis.clearInterval = previousClear;
    },
  };
}
