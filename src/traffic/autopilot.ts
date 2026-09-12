/**
 * A driver who obeys every rule in `rules.ts` and is in a hurry anyway.
 *
 * It exists for two reasons. The menu needs a car to watch, and -- much more
 * important -- the tests need to be able to ask the route a question no amount
 * of playtesting answers honestly: *is a clean run under par actually
 * possible, in every car?* A par time nobody can reach legally is not a
 * challenge, it is a bug that tells the player speeding is mandatory. The
 * autopilot is how that claim gets checked on every commit.
 *
 * It is not a good player. It never gambles on a gap and it signals for the
 * full legal beat before every move, so a human who reads the road should
 * comfortably beat it. That is the intended margin.
 */
import type { Input, Sim } from './sim';
import { OB_LIGHT, scanLanes } from './sim';
import { limitAt, nextLight, phaseAt, phaseLeft } from './route';
import { SIGNAL_LEAD, TAILGATE_HEADWAY } from './rules';

export interface AutoState {
  /** Lane change being set up, once the indicator has been on long enough. */
  intent: -1 | 0 | 1;
  cooldown: number;
}

export const AUTO_START: AutoState = { intent: 0, cooldown: 0 };

/**
 * What a lane looks like for as far as this car can see: the speed the traffic
 * in it is actually doing. This is the thing a jam is for -- from inside a
 * queue the only move available is picking the half of it that is moving, and
 * a driver who cannot see past their own bonnet cannot make it.
 */
function outlook(sim: Sim, lane: number): number {
  const from = sim.player.s;
  const to = from + sim.car.lookahead;
  if (sim.route.works.some((w) => w.lane === lane && w.to > from && w.from < to)) return -1;
  let sum = 0;
  let n = 0;
  for (const veh of sim.traffic) {
    if (veh.lane !== lane || veh.s < from || veh.s > to) continue;
    sum += veh.v;
    n += 1;
  }
  return n === 0 ? Infinity : sum / n;
}

/** Fastest you can be going `d` metres before a stop line and still stop in comfort. */
const stopSpeed = (d: number, brake: number): number => Math.sqrt(Math.max(0, 2 * brake * 0.5 * (d - 3)));

/**
 * Fastest you can follow at without closing the gap below the two-second
 * rule -- which is the tailgating threshold plus a margin, because a rule you
 * sit exactly on is a rule you break on the next bump.
 */
function followSpeed(gap: number, leadV: number, v: number, margin: number): number {
  const want = 3 + v * (TAILGATE_HEADWAY + margin);
  return Math.max(0, leadV + (gap - want) * 0.55);
}

/**
 * `dash` moves the driver from patient (0) to as assertive as the law allows
 * (1): shorter gaps, smaller holes taken, quicker to decide a lane is slow. It
 * never buys a second by breaking a rule -- that is the point of the dial.
 */
export function autopilot(
  sim: Sim, mem: AutoState, dt: number, dash = 0, overspeed = 1,
): { input: Input; mem: AutoState } {
  const { route, car, player } = sim;
  const limit = limitAt(route, player.s);
  const scans = scanLanes(sim);
  const here = scans[player.lane];
  // Half a metre under the limit: the fine starts the instant you are over it.
  // `overspeed` above 1 is a driver who does not care, which exists so the
  // tests can put the central claim of the scoring -- that it never pays --
  // to an actual drive rather than to the arithmetic alone.
  const free = Math.max(3, limit * overspeed - 0.5);
  let want = free;

  if (here.lead) {
    want = Math.min(want, here.lead.id === OB_LIGHT
      ? stopSpeed(here.lead.gap, car.brake)
      : followSpeed(here.lead.gap, here.lead.v, player.v, 0.45 - 0.3 * dash));
  }

  // The limit drops at the sign, not after it. Braking when the number
  // changes means arriving in a 40 zone doing 100, which is exactly how a
  // clean run turns into a speeding ticket at the last corner.
  const nextZone = route.zones.find((z) => z.from > player.s);
  if (nextZone && nextZone.limit < limit) {
    const d = Math.max(0, nextZone.from - player.s);
    want = Math.min(want, Math.sqrt(nextZone.limit * nextZone.limit + car.brake * 0.5 * d));
  }

  // Lights, properly: yellow is yours if you can clear it, and a red that will
  // be green before you arrive is not worth braking for.
  const light = nextLight(route, player.s, 320);
  if (light) {
    const d = light.s - player.s;
    const phase = phaseAt(light, sim.t);
    const left = phaseLeft(light, sim.t);
    const eta = d / Math.max(player.v, 1);
    const clears =
      phase === 'green' ? eta < left + light.yellow - 0.6 :
      phase === 'yellow' ? eta < left - 0.4 :
      eta > left + 0.5;
    if (!clears) want = Math.min(want, stopSpeed(d, car.brake));
  }

  // Roadworks: a closed lane is a wall, and running out of road next to one
  // with nowhere to go is the one situation worth stopping dead for.
  const closure = route.works.find((w) => w.lane === player.lane && w.to > player.s && w.from - player.s < 260);
  if (closure) want = Math.min(want, stopSpeed(closure.from - player.s, car.brake));

  let intent = mem.intent;
  let cooldown = Math.max(0, mem.cooldown - dt);
  let move: -1 | 0 | 1 = 0;
  let toggle: -1 | 0 | 1 = 0;

  const roomFor = (lane: number, urgent: boolean): boolean => {
    if (lane < 0 || lane >= route.lanes) return false;
    if (route.works.some((w) => w.lane === lane && w.to > player.s && w.from - player.s < 300)) return false;
    const s = scans[lane];
    const patience = (urgent ? 0.55 : 0.8) - 0.3 * dash;
    const needLead = car.length + 4 + player.v * patience;
    const needTrail = 4 + (s.trail?.v ?? 0) * patience;
    if (s.lead && (s.lead.gap < needLead || s.lead.id === OB_LIGHT)) return false;
    if (s.trail && s.trail.gap < needTrail) return false;
    return true;
  };

  if (player.lane === player.target && cooldown === 0) {
    if (intent === 0) {
      const urgent = closure !== undefined;
      // Judged against the free speed, not the speed this queue is allowing:
      // comparing with `want` asks "am I slower than I am?" and never fires.
      const stuck = here.lead !== null && here.lead.gap < 70 + 50 * dash && here.lead.v < free - (2.5 - 1.5 * dash);
      // Reading the road only happens with the dial up, and it is the whole
      // difference between driving and queueing: from inside a jam the only
      // move available is picking the half of it that is moving.
      const mine = dash > 0 ? outlook(sim, player.lane) : Infinity;
      if (urgent || stuck || dash > 0) {
        for (const dir of [-1, 1] as const) {
          const lane = player.lane + dir;
          if (!roomFor(lane, urgent)) continue;
          const other = scans[lane];
          const gain = (other.lead ? Math.min(free, other.lead.v + other.lead.gap / 16) : free)
            - (here.lead ? Math.min(free, here.lead.v + here.lead.gap / 16) : free);
          const reads = dash > 0 && outlook(sim, lane) > mine + 2.5 / dash;
          if (urgent || (stuck && gain > 2 - 1.3 * dash) || reads) {
            intent = dir;
            break;
          }
        }
      }
    } else if (!roomFor(player.lane + intent, closure !== undefined)) {
      intent = 0;
    } else if (player.signal !== intent) {
      toggle = intent;
    } else if (player.signalFor >= SIGNAL_LEAD + 0.1) {
      move = intent;
      intent = 0;
      cooldown = 2.5 - 1.5 * dash;
    }
  }

  return {
    input: {
      throttle: player.v < want - 0.25,
      brake: player.v > want + 0.35,
      move,
      toggle,
    },
    mem: { intent, cooldown },
  };
}
