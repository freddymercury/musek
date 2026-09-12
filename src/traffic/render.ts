/**
 * Drawing the road.
 *
 * Nothing here decides anything -- it reads a `Sim` and paints it. Keeping the
 * two apart is what lets the tests drive thousands of runs a second with no
 * canvas anywhere, and it is why the menu can show the same world as the game.
 *
 * The camera zooms out with speed. At a standstill you want to see the gap you
 * are easing into; at 100 you want to see what is coming. One value, `ppm`,
 * does that, and everything else is drawn in metres.
 */
import type { Sim, Vehicle } from './sim';
import { laneX } from './sim';
import { LANE_WIDTH, phaseAt, type Route } from './route';

const ASPHALT = '#262a33';
const MARK = 'rgba(232,236,244,0.72)';
const DASH = 'rgba(232,236,244,0.4)';

/**
 * Metres to pixels: close in when crawling, wide out at speed. The range is
 * chosen so that flat out you can still see about three and a half seconds of
 * road, which is roughly how far ahead you actually drive.
 */
export function ppmFor(v: number): number {
  const k = Math.min(1, Math.max(0, v / 28));
  return 16 - 6.6 * k;
}

/** Where the player sits on screen, as a fraction of the height. */
const EYELINE = 0.78;

interface View {
  w: number;
  h: number;
  ppm: number;
  /** Screen x of world x = 0. */
  ox: number;
  /** Screen y of the player. */
  oy: number;
  s0: number;
  from: number;
  to: number;
}

function viewOf(sim: Sim, w: number, h: number, zoom: number): View {
  const ppm = ppmFor(sim.player.v) * zoom;
  const oy = h * EYELINE;
  const ox = w * 0.54 - laneX(1) * ppm;
  return {
    w, h, ppm, ox, oy,
    s0: sim.player.s,
    from: sim.player.s - (h - oy) / ppm - 12,
    to: sim.player.s + oy / ppm + 12,
  };
}

const sx = (v: View, x: number): number => v.ox + x * v.ppm;
const sy = (v: View, s: number): number => v.oy - (s - v.s0) * v.ppm;

/** Stable pseudo-random in [0,1) from a pair of integers -- scenery that stays put. */
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x165667b1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function zoneGround(route: Route, s: number): string {
  const zone = route.zones.find((z) => s >= z.from && s < z.to) ?? route.zones[route.zones.length - 1];
  if (zone.name.includes('Expressway')) return '#101a1e';
  if (zone.name.includes('Riverside')) return '#111520';
  if (zone.name.includes('Approach')) return '#161320';
  return '#12141b';
}

function drawGround(ctx: CanvasRenderingContext2D, sim: Sim, v: View): void {
  // Bands of ground colour so a change of neighbourhood reads before the sign does.
  for (let s = Math.floor(v.from / 20) * 20; s < v.to; s += 20) {
    ctx.fillStyle = zoneGround(sim.route, s);
    ctx.fillRect(0, sy(v, s + 20) - 1, v.w, 20 * v.ppm + 2);
  }
}

function drawScenery(ctx: CanvasRenderingContext2D, sim: Sim, v: View): void {
  const blockH = 26;
  for (let n = Math.floor(v.from / blockH); n <= Math.ceil(v.to / blockH); n++) {
    const s = n * blockH;
    const zone = sim.route.zones.find((z) => s >= z.from && s < z.to);
    const seaside = zone?.name.includes('Expressway') ?? false;
    for (const side of [-1, 1] as const) {
      const r = hash(n, side);
      const y = sy(v, s + blockH);
      const hgt = blockH * v.ppm;
      if (seaside) {
        // Open water one side, scrub the other: the road stops feeling like a corridor.
        ctx.fillStyle = side < 0 ? '#0d1c24' : '#141c18';
        const x = side < 0 ? 0 : sx(v, 8.75 + 2.5);
        const w = side < 0 ? Math.max(0, sx(v, -15.75 - 2.5)) : v.w - x;
        ctx.fillRect(x, y, w, hgt);
        if (r > 0.6) {
          ctx.fillStyle = side < 0 ? 'rgba(109,169,232,0.18)' : '#1b2a20';
          ctx.fillRect(x + r * 20, y + 6, 10 + r * 26, Math.max(2, hgt * 0.25));
        }
        continue;
      }
      const depth = (3 + r * 9) * v.ppm;
      const kerb = side < 0 ? sx(v, -15.75 - 2) : sx(v, 8.75 + 2);
      const x = side < 0 ? kerb - depth : kerb;
      if (x > v.w || x + depth < 0) continue;
      // Pavement, then the buildings behind it.
      ctx.fillStyle = '#1d2029';
      ctx.fillRect(side < 0 ? kerb : sx(v, 8.75), y, side < 0 ? sx(v, -15.75) - kerb : kerb - sx(v, 8.75), hgt);
      ctx.fillStyle = r > 0.5 ? '#1a1f2c' : '#161a25';
      ctx.fillRect(x, y + 2, depth, hgt - 4);
      // A few lit windows, fixed per building.
      for (let k = 0; k < 6; k++) {
        const rw = hash(n * 31 + k, side * 7);
        if (rw < 0.45) continue;
        ctx.fillStyle = rw > 0.88 ? 'rgba(240,184,102,0.5)' : 'rgba(125,211,160,0.14)';
        ctx.fillRect(x + 6 + (k % 3) * (depth / 3.4), y + 8 + Math.floor(k / 3) * (hgt / 2.4), 5, 5);
      }
    }
  }
}

function drawCarriageway(ctx: CanvasRenderingContext2D, sim: Sim, v: View): void {
  const lanes = sim.route.lanes;
  const left = sx(v, -LANE_WIDTH / 2);
  const right = sx(v, laneX(lanes - 1) + LANE_WIDTH / 2);

  // Oncoming side, drawn first and kept plain -- it is scenery, not a hazard.
  const onLeft = sx(v, -15.75);
  ctx.fillStyle = '#1f2229';
  ctx.fillRect(onLeft, 0, sx(v, -5.25) - onLeft, v.h);

  ctx.fillStyle = ASPHALT;
  ctx.fillRect(left, 0, right - left, v.h);

  // Median.
  ctx.fillStyle = '#191c23';
  ctx.fillRect(sx(v, -5.25), 0, sx(v, -LANE_WIDTH / 2) - sx(v, -5.25), v.h);
  ctx.strokeStyle = 'rgba(232,236,244,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx(v, -3.5), 0);
  ctx.lineTo(sx(v, -3.5), v.h);
  ctx.stroke();

  // Edge lines, solid.
  ctx.strokeStyle = MARK;
  ctx.lineWidth = 2;
  for (const x of [left + 2, right - 2]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, v.h);
    ctx.stroke();
  }

  // Lane dashes: 3 m of paint, 6 m of gap, anchored to the road so they scroll
  // with it rather than with the frame.
  ctx.strokeStyle = DASH;
  ctx.lineWidth = 1.5;
  for (let lane = 1; lane < lanes; lane++) {
    const x = sx(v, laneX(lane) - LANE_WIDTH / 2);
    for (let s = Math.floor(v.from / 9) * 9; s < v.to; s += 9) {
      ctx.beginPath();
      ctx.moveTo(x, sy(v, s));
      ctx.lineTo(x, sy(v, s + 3));
      ctx.stroke();
    }
  }
}

function drawOncoming(ctx: CanvasRenderingContext2D, sim: Sim, v: View): void {
  for (let lane = 0; lane < 3; lane++) {
    const spacing = 34 + lane * 9;
    const speed = 15 + lane * 5;
    const drift = speed * sim.t;
    const x = -15.75 + 1.75 + lane * LANE_WIDTH;
    for (let n = Math.floor((v.from + drift) / spacing); n <= Math.ceil((v.to + drift) / spacing); n++) {
      const r = hash(n, lane + 91);
      if (r < 0.42) continue;
      const s = n * spacing - drift;
      const len = 4 + r * 1.6;
      ctx.fillStyle = r > 0.8 ? '#586074' : '#464e5f';
      roundRect(ctx, sx(v, x - 0.9), sy(v, s + len / 2), 1.8 * v.ppm, len * v.ppm, 3);
      ctx.fill();
      // Headlights, because they are coming towards you.
      ctx.fillStyle = 'rgba(240,230,190,0.55)';
      ctx.fillRect(sx(v, x - 0.75), sy(v, s - len / 2) - 2, 3, 2);
      ctx.fillRect(sx(v, x + 0.35), sy(v, s - len / 2) - 2, 3, 2);
    }
  }
}

function drawWorks(ctx: CanvasRenderingContext2D, sim: Sim, v: View): void {
  for (const w of sim.route.works) {
    if (w.to < v.from || w.from > v.to) continue;
    const x0 = sx(v, laneX(w.lane) - LANE_WIDTH / 2);
    const wid = LANE_WIDTH * v.ppm;
    const yTop = sy(v, w.to);
    const yBot = sy(v, w.from);

    ctx.fillStyle = 'rgba(240,184,102,0.09)';
    ctx.fillRect(x0, yTop, wid, yBot - yTop);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, yTop, wid, yBot - yTop);
    ctx.clip();
    ctx.strokeStyle = 'rgba(240,184,102,0.3)';
    ctx.lineWidth = 3;
    for (let k = -20; k < 60; k++) {
      ctx.beginPath();
      ctx.moveTo(x0 + k * 14, yBot);
      ctx.lineTo(x0 + k * 14 + (yBot - yTop), yTop);
      ctx.stroke();
    }
    ctx.restore();

    // Cones, closing the lane off at a taper.
    for (let s = w.from; s <= w.to; s += 7) {
      for (const edge of [-1, 1] as const) {
        const cx = sx(v, laneX(w.lane) + edge * (LANE_WIDTH / 2 - 0.3));
        const cy = sy(v, s);
        ctx.fillStyle = '#e2726e';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 4);
        ctx.lineTo(cx + 3, cy + 3);
        ctx.lineTo(cx - 3, cy + 3);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}

function drawLights(ctx: CanvasRenderingContext2D, sim: Sim, v: View): void {
  for (const light of sim.route.lights) {
    if (light.s < v.from || light.s > v.to) continue;
    const phase = phaseAt(light, sim.t);
    const y = sy(v, light.s);
    const left = sx(v, -LANE_WIDTH / 2);
    const right = sx(v, laneX(sim.route.lanes - 1) + LANE_WIDTH / 2);

    ctx.fillStyle = 'rgba(232,236,244,0.85)';
    ctx.fillRect(left, y - 3, right - left, 4);

    // The head, on a mast over the offside verge.
    const hx = right + 16;
    ctx.strokeStyle = '#3a4152';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(hx, y);
    ctx.lineTo(right + 2, y);
    ctx.stroke();
    ctx.fillStyle = '#12151c';
    roundRect(ctx, hx - 7, y - 26, 15, 38, 4);
    ctx.fill();
    const lamps: Array<['green' | 'yellow' | 'red', string]> = [
      ['red', '#e2726e'], ['yellow', '#f0b866'], ['green', '#7dd3a0'],
    ];
    lamps.forEach(([which, colour], i) => {
      const on = phase === which;
      ctx.beginPath();
      ctx.arc(hx, y - 19 + i * 11, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = on ? colour : 'rgba(255,255,255,0.08)';
      if (on) {
        ctx.shadowColor = colour;
        ctx.shadowBlur = 14;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  }
}

function drawSigns(ctx: CanvasRenderingContext2D, sim: Sim, v: View): void {
  for (const zone of sim.route.zones) {
    if (zone.from < v.from || zone.from > v.to || zone.from === 0) continue;
    const y = sy(v, zone.from);
    const x = sx(v, laneX(sim.route.lanes - 1) + LANE_WIDTH / 2) + 34;
    ctx.strokeStyle = '#3a4152';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - 6, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#f3f5fa';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#e2726e';
    ctx.stroke();
    ctx.fillStyle = '#12151c';
    ctx.font = 'bold 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.round(zone.limit * 3.6)), x, y - 5);
  }
}

function drawArena(ctx: CanvasRenderingContext2D, sim: Sim, v: View): void {
  const end = sim.route.length;
  if (end > v.to + 40) return;
  const y = sy(v, end);
  // Chequered line at the car park entrance.
  const left = sx(v, -LANE_WIDTH / 2);
  const right = sx(v, laneX(sim.route.lanes - 1) + LANE_WIDTH / 2);
  const cell = 9;
  for (let i = 0; i * cell < right - left; i++) {
    for (let j = 0; j < 3; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#f3f5fa' : '#2c313c';
      ctx.fillRect(left + i * cell, y - 3 - j * cell, cell, cell);
    }
  }
  ctx.fillStyle = '#1b2130';
  ctx.fillRect(left - 60, y - 150, right - left + 120, 120);
  ctx.fillStyle = '#7dd3a0';
  ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('MERIDIAN ARENA', (left + right) / 2, y - 92);
  ctx.fillStyle = 'rgba(240,184,102,0.85)';
  ctx.font = '13px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
  ctx.fillText(sim.route.seat.toUpperCase(), (left + right) / 2, y - 68);
}

interface Painted {
  s: number;
  x: number;
  length: number;
  width: number;
  body: string;
  trim: string;
  braking: boolean;
  signal: -1 | 0 | 1;
  yaw: number;
  hero: boolean;
}

function drawCar(ctx: CanvasRenderingContext2D, v: View, c: Painted, t: number): void {
  const w = c.width * v.ppm;
  const l = c.length * v.ppm;
  const cx = sx(v, c.x);
  const cy = sy(v, c.s);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(c.yaw);

  if (c.hero) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 3;
  }
  ctx.fillStyle = c.body;
  roundRect(ctx, -w / 2, -l / 2, w, l, Math.min(6, w / 3));
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Glass: windscreen forward, rear window aft.
  ctx.fillStyle = 'rgba(12,16,24,0.55)';
  roundRect(ctx, -w * 0.36, -l * 0.34, w * 0.72, l * 0.2, 2);
  ctx.fill();
  roundRect(ctx, -w * 0.36, l * 0.16, w * 0.72, l * 0.16, 2);
  ctx.fill();
  ctx.fillStyle = c.trim;
  ctx.globalAlpha = 0.22;
  ctx.fillRect(-w * 0.42, -l * 0.1, w * 0.84, l * 0.22);
  ctx.globalAlpha = 1;

  if (c.braking) {
    ctx.fillStyle = '#ff5a52';
    ctx.shadowColor = '#ff5a52';
    ctx.shadowBlur = 10;
    ctx.fillRect(-w / 2 + 1, l / 2 - 3, w * 0.26, 3);
    ctx.fillRect(w / 2 - 1 - w * 0.26, l / 2 - 3, w * 0.26, 3);
    ctx.shadowBlur = 0;
  }

  if (c.signal !== 0 && Math.floor(t * 2.4) % 2 === 0) {
    ctx.fillStyle = '#f0b866';
    ctx.shadowColor = '#f0b866';
    ctx.shadowBlur = 12;
    const x = c.signal < 0 ? -w / 2 : w / 2 - w * 0.22;
    ctx.fillRect(x, -l / 2 + 1, w * 0.22, 3);
    ctx.fillRect(x, l / 2 - 4, w * 0.22, 3);
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

/**
 * How far the nose is turned, from how fast the car is crossing the lane.
 * Clamped hard: the honest arctangent of a lane change at walking pace is
 * about fifty degrees, which looks like a spin rather than a lane change.
 */
const MAX_YAW = 0.2;

function yawOf(fromLane: number, toLane: number, cross: number, duration: number, v: number): number {
  if (fromLane === toLane) return 0;
  const lateral = (laneX(toLane) - laneX(fromLane)) * 6 * cross * (1 - cross) / duration;
  const yaw = Math.atan2(lateral, Math.max(v, 9)) * 0.7;
  return Math.max(-MAX_YAW, Math.min(MAX_YAW, yaw));
}

const painted = (veh: Vehicle): Painted => ({
  s: veh.s, x: veh.x, length: veh.length, width: veh.width,
  body: veh.colour, trim: '#e8ecf4', braking: veh.braking, signal: veh.signal,
  yaw: yawOf(veh.lane, veh.target, veh.cross, 1.1, veh.v), hero: false,
});

/** `zoom` pulls the camera back -- the menu wants to show more road than the driver does. */
export function draw(ctx: CanvasRenderingContext2D, sim: Sim, w: number, h: number, zoom = 1): void {
  const v = viewOf(sim, w, h, zoom);
  ctx.clearRect(0, 0, w, h);
  drawGround(ctx, sim, v);
  drawScenery(ctx, sim, v);
  drawCarriageway(ctx, sim, v);
  drawOncoming(ctx, sim, v);
  drawWorks(ctx, sim, v);
  drawArena(ctx, sim, v);
  drawLights(ctx, sim, v);
  drawSigns(ctx, sim, v);

  for (const veh of sim.traffic) {
    if (veh.s < v.from - 8 || veh.s > v.to + 8) continue;
    drawCar(ctx, v, painted(veh), sim.t);
  }

  const p = sim.player;
  drawCar(ctx, v, {
    s: p.s, x: p.x, length: sim.car.length, width: sim.car.width,
    body: sim.car.body, trim: sim.car.trim, braking: p.braking, signal: p.signal,
    yaw: yawOf(p.lane, p.target, p.cross, sim.car.laneChange, p.v), hero: true,
  }, sim.t);

  if (sim.crashed) {
    ctx.fillStyle = 'rgba(226,114,110,0.22)';
    ctx.fillRect(0, 0, w, h);
  }
}

/**
 * The strip down the side of the dashboard: everything between you and the
 * limit of what this car can see. It is the only place the van's driving
 * position turns into an actual advantage.
 */
export function drawRadar(ctx: CanvasRenderingContext2D, sim: Sim, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  const reach = sim.car.lookahead;
  const pad = 10;
  const laneW = (w - pad * 2) / sim.route.lanes;
  const y = (s: number): number => h - 14 - ((s - sim.player.s) / reach) * (h - 26);

  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(pad, 0, w - pad * 2, h);

  for (const wk of sim.route.works) {
    if (wk.to < sim.player.s || wk.from > sim.player.s + reach) continue;
    ctx.fillStyle = 'rgba(240,184,102,0.22)';
    const top = y(Math.min(wk.to, sim.player.s + reach));
    ctx.fillRect(pad + wk.lane * laneW, top, laneW, y(Math.max(wk.from, sim.player.s)) - top);
  }

  for (const veh of sim.traffic) {
    if (veh.s < sim.player.s - 10 || veh.s > sim.player.s + reach) continue;
    // Colour by how much slower than you they are: red means you are closing.
    const closing = sim.player.v - veh.v;
    ctx.fillStyle = closing > 6 ? '#e2726e' : closing > 1.5 ? '#f0b866' : '#7dd3a0';
    ctx.globalAlpha = 0.85;
    const x = pad + (veh.x / LANE_WIDTH) * laneW + laneW * 0.18;
    ctx.fillRect(x, y(veh.s) - 3, laneW * 0.64, 6);
    ctx.globalAlpha = 1;
  }

  for (const light of sim.route.lights) {
    if (light.s < sim.player.s || light.s > sim.player.s + reach) continue;
    const phase = phaseAt(light, sim.t);
    ctx.fillStyle = phase === 'green' ? '#7dd3a0' : phase === 'yellow' ? '#f0b866' : '#e2726e';
    ctx.fillRect(pad, y(light.s) - 1.5, w - pad * 2, 3);
  }

  // You, at the bottom.
  ctx.fillStyle = sim.car.body;
  const px = pad + (sim.player.x / LANE_WIDTH) * laneW + laneW * 0.18;
  ctx.fillRect(px, y(sim.player.s) - 4, laneW * 0.64, 8);
}
