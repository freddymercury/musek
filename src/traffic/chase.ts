/**
 * The view from behind your own back bumper.
 *
 * The road is dead straight, which is the one thing that makes a proper
 * perspective view cheap: a straight road projects to a trapezoid, so the
 * whole carriageway is a single polygon and every object on it is a box drawn
 * at the right size for its distance. No meshes, no depth buffer, no library
 * -- one projection function, a painter's-algorithm sort, and a fog gradient
 * over the far clip.
 *
 *     scale = focal / distance
 *     x = w/2 + (worldX - camX) * scale * w/2
 *     y = horizon + (camHeight - worldY) * scale * w/2
 *
 * Both axes use w/2 so pixels stay square; the horizon is where everything
 * ends up as distance runs to infinity, which is why it is a constant and not
 * something that needs computing.
 *
 * The reason to do this at all: sitting in a queue is a completely different
 * feeling when the car in front fills your windscreen instead of being a
 * rectangle two centimetres away on a map.
 */
import type { Sim, Vehicle } from './sim';
import { laneX } from './sim';
import { LANE_WIDTH, phaseAt, type Route } from './route';

/** Horizontal field of view. Wide enough to see the next lane, narrow enough not to fish-eye. */
const FOV = (58 * Math.PI) / 180;
const FOCAL = 1 / Math.tan(FOV / 2);
/** How far up the screen the vanishing point sits. */
const HORIZON = 0.44;
/** Anything nearer than this is behind the windscreen. */
const NEAR = 1.6;
const DRAW = 340;

export interface Cam {
  /** Where the camera is, metres along the route. */
  s: number;
  x: number;
  height: number;
  w: number;
  h: number;
  horizon: number;
  k: number;
}

export function camFor(sim: Sim, w: number, h: number): Cam {
  // Pull back and rise a little with speed: the faster you go the further
  // ahead you need to be reading, and the more the car needs to shrink.
  const v = Math.min(sim.player.v, 32);
  return {
    s: sim.player.s - (11 + v * 0.14),
    x: sim.player.x * 0.94,
    height: 5.2 + v * 0.035,
    w, h,
    horizon: h * HORIZON,
    k: w / 2,
  };
}

interface P {
  x: number;
  y: number;
  scale: number;
}

function project(cam: Cam, x: number, y: number, s: number): P | null {
  const dz = s - cam.s;
  if (dz < NEAR) return null;
  const scale = (FOCAL / dz) * cam.k;
  return {
    x: cam.w / 2 + (x - cam.x) * scale,
    y: cam.horizon + (cam.height - y) * scale,
    scale,
  };
}

/** Screen y of the road surface at distance `s`, clamped to the horizon. */
function roadY(cam: Cam, s: number): number {
  const p = project(cam, 0, 0, s);
  return p ? p.y : cam.h;
}

function poly(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, fill: string): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Multiply a #rrggbb by a factor, for faking a light source without one. */
function shade(colour: string, k: number): string {
  const n = parseInt(colour.slice(1), 16);
  const f = (c: number): number => Math.max(0, Math.min(255, Math.round(c * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** A flat patch of road: the four corners of a rectangle lying on the tarmac. */
function slab(
  ctx: CanvasRenderingContext2D, cam: Cam,
  x0: number, x1: number, s0: number, s1: number, fill: string,
): void {
  const near = Math.max(s0, cam.s + NEAR);
  if (s1 <= near) return;
  const a = project(cam, x0, 0, near);
  const b = project(cam, x1, 0, near);
  const c = project(cam, x1, 0, s1);
  const d = project(cam, x0, 0, s1);
  if (!a || !b || !c || !d) return;
  poly(ctx, [[a.x, a.y], [b.x, b.y], [c.x, c.y], [d.x, d.y]], fill);
}

/**
 * An upright box, drawn as the three faces you can actually see from here:
 * the near end, the top, and whichever side the camera is off to.
 */
function box(
  ctx: CanvasRenderingContext2D, cam: Cam,
  o: {
    x: number; width: number; sNear: number; depth: number; height: number;
    colour: string; yaw?: number;
    /** Overall brightness, for a part of the same body that catches less light. */
    tint?: number;
  },
): void {
  const sFar = o.sNear + o.depth;
  if (sFar < cam.s + NEAR) return;
  const near = Math.max(o.sNear, cam.s + NEAR);
  // A lane change shifts the far end sideways: enough of a skew to read as
  // a car turning in, without needing a rotation matrix.
  const drift = (o.yaw ?? 0) * o.depth;
  const left = o.x - o.width / 2;
  const right = o.x + o.width / 2;

  const nl = project(cam, left, 0, near);
  const nr = project(cam, right, 0, near);
  const nlt = project(cam, left, o.height, near);
  const nrt = project(cam, right, o.height, near);
  const fl = project(cam, left + drift, 0, sFar);
  const fr = project(cam, right + drift, 0, sFar);
  const flt = project(cam, left + drift, o.height, sFar);
  const frt = project(cam, right + drift, o.height, sFar);
  if (!nl || !nr || !nlt || !nrt || !fl || !fr || !flt || !frt) return;

  const tint = o.tint ?? 1;
  // The side face, if the camera is off to one side of it.
  if (o.x > cam.x) {
    poly(ctx, [[nl.x, nl.y], [fl.x, fl.y], [flt.x, flt.y], [nlt.x, nlt.y]], shade(o.colour, 0.62 * tint));
  } else if (o.x < cam.x) {
    poly(ctx, [[nr.x, nr.y], [fr.x, fr.y], [frt.x, frt.y], [nrt.x, nrt.y]], shade(o.colour, 0.62 * tint));
  }
  poly(ctx, [[nlt.x, nlt.y], [nrt.x, nrt.y], [frt.x, frt.y], [flt.x, flt.y]], shade(o.colour, 1.18 * tint));
  poly(ctx, [[nl.x, nl.y], [nr.x, nr.y], [nrt.x, nrt.y], [nlt.x, nlt.y]], shade(o.colour, tint));
}

function zoneOf(route: Route, s: number) {
  return route.zones.find((z) => s >= z.from && s < z.to) ?? route.zones[route.zones.length - 1];
}

function groundColour(route: Route, s: number): string {
  const name = zoneOf(route, s).name;
  if (name.includes('Expressway')) return '#0e1a1f';
  if (name.includes('Riverside')) return '#101420';
  if (name.includes('Approach')) return '#15121f';
  return '#111319';
}

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x165667b1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const ROAD_LEFT = -LANE_WIDTH / 2;

function roadRight(route: Route): number {
  return laneX(route.lanes - 1) + LANE_WIDTH / 2;
}

function drawSky(ctx: CanvasRenderingContext2D, cam: Cam, sim: Sim): void {
  const sky = ctx.createLinearGradient(0, 0, 0, cam.horizon);
  sky.addColorStop(0, '#080a10');
  sky.addColorStop(1, '#1b2130');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, cam.w, cam.horizon + 1);

  // Ground, painted near zone over far zone so a change of neighbourhood
  // arrives as a line across the road rather than a pop.
  ctx.fillStyle = groundColour(sim.route, cam.s + DRAW);
  ctx.fillRect(0, cam.horizon, cam.w, cam.h - cam.horizon);
  for (const zone of sim.route.zones) {
    const top = roadY(cam, Math.min(zone.to, cam.s + DRAW));
    const bottom = roadY(cam, zone.from);
    if (bottom <= top) continue;
    ctx.fillStyle = groundColour(sim.route, (zone.from + zone.to) / 2);
    ctx.fillRect(0, top, cam.w, bottom - top);
  }
}

function drawRoad(ctx: CanvasRenderingContext2D, cam: Cam, sim: Sim): void {
  const { route } = sim;
  const right = roadRight(route);
  const far = cam.s + DRAW;

  // Pavements either side, then the carriageway.
  slab(ctx, cam, right, right + 2.6, cam.s, far, '#1c2028');
  slab(ctx, cam, -5.25, ROAD_LEFT, cam.s, far, '#171a21');
  slab(ctx, cam, -15.75, -5.25, cam.s, far, '#22252d');
  slab(ctx, cam, ROAD_LEFT, right, cam.s, far, '#2a2e38');

  // Edge lines.
  slab(ctx, cam, ROAD_LEFT + 0.1, ROAD_LEFT + 0.35, cam.s, far, 'rgba(232,236,244,0.6)');
  slab(ctx, cam, right - 0.35, right - 0.1, cam.s, far, 'rgba(232,236,244,0.6)');
  // Median barrier base.
  slab(ctx, cam, -3.7, -3.3, cam.s, far, 'rgba(232,236,244,0.22)');

  // Lane dashes: 3 m of paint every 9 m, anchored to the road so they run
  // towards you at the speed you are actually doing.
  const from = Math.floor((cam.s + NEAR) / 9) * 9;
  for (let lane = 1; lane < route.lanes; lane++) {
    const x = laneX(lane) - LANE_WIDTH / 2;
    for (let s = from; s < far; s += 9) {
      slab(ctx, cam, x - 0.12, x + 0.12, s, s + 3, 'rgba(232,236,244,0.42)');
    }
  }

  for (const w of route.works) {
    if (w.to < cam.s || w.from > far || w.kind !== 'roadworks') continue;
    slab(ctx, cam, laneX(w.lane) - LANE_WIDTH / 2, laneX(w.lane) + LANE_WIDTH / 2,
      w.from, Math.min(w.to, far), 'rgba(240,184,102,0.13)');
  }

  for (const light of route.lights) {
    if (light.s < cam.s || light.s > far) continue;
    slab(ctx, cam, ROAD_LEFT, right, light.s - 0.5, light.s + 0.3, 'rgba(232,236,244,0.8)');
  }

  if (route.length < far && route.length > cam.s) {
    // The chequered line at the car park entrance.
    const cell = LANE_WIDTH / 2;
    for (let i = 0; i < (roadRight(route) - ROAD_LEFT) / cell; i++) {
      for (let j = 0; j < 2; j++) {
        const x = ROAD_LEFT + i * cell;
        slab(ctx, cam, x, x + cell, route.length + j * 1.2, route.length + (j + 1) * 1.2,
          (i + j) % 2 ? '#f3f5fa' : '#20242c');
      }
    }
  }
}

interface Prop {
  s: number;
  draw: () => void;
}

function carProps(ctx: CanvasRenderingContext2D, cam: Cam, sim: Sim, out: Prop[]): void {
  const paint = (v: Vehicle | null): void => {
    const c = v ?? null;
    const x = c ? c.x : sim.player.x;
    const s = c ? c.s : sim.player.s;
    const len = c ? c.length : sim.car.length;
    const wide = c ? c.width : sim.car.width;
    const lorry = wide > 2.2;
    // A car is a low body with a cabin sat on it. One box is a van, and every
    // vehicle on the road reading as a van is the difference between traffic
    // and a row of crates.
    const bodyHigh = lorry ? 3.2 : 0.78;
    const roofHigh = lorry ? 3.4 : 1.46;
    const colour = c ? c.colour : sim.car.body;
    const braking = c ? c.braking : sim.player.braking;
    const signal = c ? c.signal : sim.player.signal;
    const lane = c ? c.lane : sim.player.lane;
    const target = c ? c.target : sim.player.target;
    const cross = c ? c.cross : sim.player.cross;
    const speed = c ? c.v : sim.player.v;
    const yaw = lane === target ? 0
      : ((laneX(target) - laneX(lane)) * 6 * cross * (1 - cross)) / (Math.max(speed, 7) * (c ? 1.1 : sim.car.laneChange));

    out.push({
      s,
      draw: () => {
        const sNear = s - len / 2;
        box(ctx, cam, { x, width: wide, sNear, depth: len, height: bodyHigh, colour, yaw });
        const cabinAt = sNear + len * 0.16;
        if (!lorry) {
          box(ctx, cam, {
            x, width: wide * 0.88, sNear: cabinAt, depth: len * 0.58,
            height: roofHigh, colour, tint: 0.92, yaw,
          });
        }
        // The back window sits on the cabin's rear face, which is further away
        // than the bumper -- projecting it at the bumper draws it too big, and
        // a pane of glass wider than the car is a memorable way to find out.
        const glass = project(cam, x, bodyHigh, cabinAt);
        if (!glass) return;

        // Glass, then lamps. Everything is sized off the projection, so a car
        // fifty metres away gets fifty-metre-away tail lights.
        if (!lorry) {
          const glassW = wide * 0.62 * glass.scale;
          const glassH = (roofHigh - bodyHigh) * 0.58 * glass.scale;
          const top = glass.y - glassH - 0.08 * glass.scale;
          poly(ctx, [
            [glass.x - glassW / 2, top], [glass.x + glassW / 2, top],
            [glass.x + glassW / 2, glass.y - 0.08 * glass.scale],
            [glass.x - glassW / 2, glass.y - 0.08 * glass.scale],
          ], 'rgba(10,14,22,0.62)');
        }

        // Lamps sit where lamps sit -- a bit under a metre up -- not at
        // whatever height this particular body happens to end at.
        const lamps = project(cam, x, lorry ? 1.0 : 0.56, sNear);
        if (!lamps) return;
        const lampW = wide * 0.2 * lamps.scale;
        const lampH = 0.18 * lamps.scale;
        const lampY = lamps.y - lampH / 2;
        const inset = wide * 0.5 * lamps.scale - lampW;
        ctx.fillStyle = braking ? '#ff5a52' : '#8d2f2c';
        if (braking) {
          ctx.shadowColor = '#ff5a52';
          ctx.shadowBlur = Math.min(26, lamps.scale * 0.5 + 6);
        }
        ctx.fillRect(lamps.x - inset - lampW, lampY, lampW, lampH);
        ctx.fillRect(lamps.x + inset, lampY, lampW, lampH);
        ctx.shadowBlur = 0;

        if (signal !== 0 && Math.floor(sim.t * 2.4) % 2 === 0) {
          ctx.fillStyle = '#f0b866';
          ctx.shadowColor = '#f0b866';
          ctx.shadowBlur = 14;
          const sx = signal < 0 ? lamps.x - inset - lampW * 1.95 : lamps.x + inset + lampW * 0.95;
          ctx.fillRect(sx, lampY, lampW * 0.9, lampH);
          ctx.shadowBlur = 0;
        }
      },
    });
  };

  for (const v of sim.traffic) {
    if (v.s < cam.s - 6 || v.s > cam.s + DRAW) continue;
    paint(v);
  }
  paint(null);
}

/** The other carriageway, which is scenery: a function of the clock, with no state. */
function oncomingProps(ctx: CanvasRenderingContext2D, cam: Cam, sim: Sim, out: Prop[]): void {
  for (let lane = 0; lane < 3; lane++) {
    const spacing = 30 + lane * 11;
    const speed = 15 + lane * 5;
    const drift = speed * sim.t;
    const x = -14 + lane * LANE_WIDTH;
    const from = Math.floor((cam.s + drift) / spacing);
    const to = Math.ceil((cam.s + DRAW * 0.75 + drift) / spacing);
    for (let n = from; n <= to; n++) {
      const r = hash(n, lane + 91);
      if (r < 0.45) continue;
      const s = n * spacing - drift;
      if (s < cam.s + NEAR) continue;
      const len = 4 + r * 1.8;
      out.push({
        s,
        draw: () => {
          box(ctx, cam, {
            x, width: 1.8, sNear: s, depth: len, height: 1.4,
            colour: r > 0.8 ? '#3d4453' : '#333949',
          });
          const front = project(cam, x, 0.7, s);
          if (!front) return;
          ctx.fillStyle = 'rgba(244,238,214,0.8)';
          ctx.shadowColor = 'rgba(244,238,214,0.9)';
          ctx.shadowBlur = 12;
          const lw = 0.34 * front.scale;
          ctx.fillRect(front.x - 0.62 * front.scale, front.y, lw, 0.16 * front.scale);
          ctx.fillRect(front.x + 0.28 * front.scale, front.y, lw, 0.16 * front.scale);
          ctx.shadowBlur = 0;
        },
      });
    }
  }
}

function sceneryProps(ctx: CanvasRenderingContext2D, cam: Cam, sim: Sim, out: Prop[]): void {
  const right = roadRight(sim.route);
  const block = 22;
  for (let n = Math.floor(cam.s / block); n <= Math.ceil((cam.s + DRAW) / block); n++) {
    const s = n * block;
    if (s < cam.s + NEAR) continue;
    const seaside = zoneOf(sim.route, s).name.includes('Expressway');
    for (const side of [-1, 1] as const) {
      const r = hash(n, side * 17);
      if (seaside) {
        if (r < 0.72) continue;
        const x = side < 0 ? -21 - r * 5 : right + 5 + r * 5;
        out.push({
          s,
          draw: () => box(ctx, cam, {
            x, width: 1.4, sNear: s, depth: 1.4, height: 3 + r * 3, colour: '#1d2a22',
          }),
        });
        continue;
      }
      const depth = 8 + r * 16;
      const wide = 10 + hash(n, side * 31) * 14;
      const x = side < 0 ? -18.5 - wide / 2 : right + 3 + wide / 2;
      const height = 9 + r * 26;
      out.push({
        s,
        draw: () => {
          box(ctx, cam, { x, width: wide, sNear: s, depth, height, colour: r > 0.5 ? '#191d28' : '#151822' });
          // Lit windows on the face turned towards the road.
          const face = project(cam, x + (side < 0 ? wide / 2 : -wide / 2), 0, s + depth / 2);
          if (!face || face.scale < 2) return;
          for (let k = 0; k < 14; k++) {
            const rw = hash(n * 41 + k, side);
            if (rw < 0.62) continue;
            const up = (0.12 + (k % 7) * 0.13) * height;
            const along = ((Math.floor(k / 7) + 0.5) / 2 - 0.5) * depth;
            const p = project(cam, x + (side < 0 ? wide / 2 : -wide / 2), up, s + depth / 2 + along);
            if (!p) continue;
            ctx.fillStyle = rw > 0.9 ? 'rgba(240,184,102,0.55)' : 'rgba(125,211,160,0.16)';
            ctx.fillRect(p.x - 0.22 * p.scale, p.y - 0.5 * p.scale, 0.44 * p.scale, 0.5 * p.scale);
          }
        },
      });
    }
  }
}

function furnitureProps(ctx: CanvasRenderingContext2D, cam: Cam, sim: Sim, out: Prop[]): void {
  const right = roadRight(sim.route);

  for (const light of sim.route.lights) {
    if (light.s < cam.s + NEAR || light.s > cam.s + DRAW) continue;
    const phase = phaseAt(light, sim.t);
    out.push({
      s: light.s,
      draw: () => {
        // Mast on the offside verge with the head out over the carriageway.
        box(ctx, cam, { x: right + 1.2, width: 0.3, sNear: light.s, depth: 0.3, height: 6.4, colour: '#2b3140' });
        const head = project(cam, right - 1.4, 5.2, light.s);
        if (!head) return;
        const r = 0.24 * head.scale;
        if (r < 0.6) return;
        poly(ctx, [
          [head.x - r * 1.5, head.y - r * 4.2], [head.x + r * 1.5, head.y - r * 4.2],
          [head.x + r * 1.5, head.y + r * 1.6], [head.x - r * 1.5, head.y + r * 1.6],
        ], '#10131a');
        const lamps: Array<['green' | 'yellow' | 'red', string]> = [
          ['red', '#e2726e'], ['yellow', '#f0b866'], ['green', '#7dd3a0'],
        ];
        lamps.forEach(([which, colour], i) => {
          const on = phase === which;
          ctx.beginPath();
          ctx.arc(head.x, head.y - r * 3.1 + i * r * 1.9, r * 0.78, 0, Math.PI * 2);
          ctx.fillStyle = on ? colour : 'rgba(255,255,255,0.07)';
          if (on) {
            ctx.shadowColor = colour;
            ctx.shadowBlur = Math.min(30, r * 6);
          }
          ctx.fill();
          ctx.shadowBlur = 0;
        });
      },
    });
  }

  for (const zone of sim.route.zones) {
    if (zone.from < cam.s + NEAR || zone.from > cam.s + DRAW || zone.from === 0) continue;
    out.push({
      s: zone.from,
      draw: () => {
        box(ctx, cam, { x: right + 1.6, width: 0.16, sNear: zone.from, depth: 0.16, height: 2.1, colour: '#2b3140' });
        const p = project(cam, right + 1.6, 2.6, zone.from);
        if (!p) return;
        const r = 0.52 * p.scale;
        if (r < 5) return;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#f3f5fa';
        ctx.fill();
        ctx.lineWidth = r * 0.26;
        ctx.strokeStyle = '#e2726e';
        ctx.stroke();
        ctx.fillStyle = '#12151c';
        ctx.font = `bold ${Math.round(r * 0.95)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.round(zone.limit * 3.6)), p.x, p.y + r * 0.05);
      },
    });
  }

  for (const w of sim.route.works) {
    if (w.to < cam.s + NEAR || w.from > cam.s + DRAW) continue;

    if (w.kind === 'stalled') {
      // Somebody's morning going wrong, hazards going, in your lane.
      out.push({
        s: w.from,
        draw: () => {
          const x = laneX(w.lane);
          const len = w.to - w.from;
          box(ctx, cam, { x, width: 1.9, sNear: w.from, depth: len, height: 0.8, colour: '#767f92' });
          box(ctx, cam, {
            x, width: 1.68, sNear: w.from + len * 0.16, depth: len * 0.58,
            height: 1.5, colour: '#767f92', tint: 0.9,
          });
          if (Math.floor(sim.t * 1.6) % 2) return;
          const p = project(cam, x, 0.6, w.from);
          if (!p) return;
          ctx.fillStyle = '#f0b866';
          ctx.shadowColor = '#f0b866';
          ctx.shadowBlur = 16;
          const lw = 0.36 * p.scale;
          ctx.fillRect(p.x - 0.85 * p.scale, p.y, lw, 0.2 * p.scale);
          ctx.fillRect(p.x + 0.49 * p.scale, p.y, lw, 0.2 * p.scale);
          ctx.shadowBlur = 0;
        },
      });
      continue;
    }

    for (let s = w.from; s <= w.to; s += 6) {
      if (s < cam.s + NEAR) continue;
      for (const edge of [-1, 1] as const) {
        const x = laneX(w.lane) + edge * (LANE_WIDTH / 2 - 0.25);
        out.push({
          s,
          draw: () => box(ctx, cam, {
            x, width: 0.45, sNear: s, depth: 0.45, height: 0.75, colour: '#e2726e',
          }),
        });
      }
    }
  }

  const end = sim.route.length;
  if (end > cam.s && end < cam.s + DRAW) {
    out.push({
      s: end + 20,
      draw: () => {
        box(ctx, cam, {
          x: laneX(1), width: 46, sNear: end + 12, depth: 26, height: 17, colour: '#1b2130',
        });
        const p = project(cam, laneX(1), 12, end + 12);
        if (!p || p.scale < 3) return;
        ctx.fillStyle = '#7dd3a0';
        ctx.font = `bold ${Math.round(1.6 * p.scale)}px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('MERIDIAN ARENA', p.x, p.y);
        ctx.fillStyle = 'rgba(240,184,102,0.9)';
        ctx.font = `${Math.round(1 * p.scale)}px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
        ctx.fillText(sim.route.seat.toUpperCase(), p.x, p.y + 2 * p.scale);
      },
    });
  }
}

export function drawChase(ctx: CanvasRenderingContext2D, sim: Sim, w: number, h: number): void {
  const cam = camFor(sim, w, h);
  ctx.clearRect(0, 0, w, h);
  drawSky(ctx, cam, sim);
  drawRoad(ctx, cam, sim);

  // Painter's algorithm: everything upright, sorted back to front. With a
  // straight road and no overlapping geometry that is all the depth sorting
  // this needs.
  const props: Prop[] = [];
  sceneryProps(ctx, cam, sim, props);
  oncomingProps(ctx, cam, sim, props);
  furnitureProps(ctx, cam, sim, props);
  carProps(ctx, cam, sim, props);
  props.sort((a, b) => b.s - a.s);
  for (const p of props) p.draw();

  // Haze over the far clip, so the world runs out of detail instead of road.
  const fog = ctx.createLinearGradient(0, cam.horizon - h * 0.06, 0, cam.horizon + h * 0.2);
  fog.addColorStop(0, 'rgba(17,20,28,0.95)');
  fog.addColorStop(1, 'rgba(17,20,28,0)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, cam.horizon - h * 0.06, w, h * 0.26);

  if (sim.crashed) {
    ctx.fillStyle = 'rgba(226,114,110,0.25)';
    ctx.fillRect(0, 0, w, h);
  }
}
