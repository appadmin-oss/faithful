/**
 * Physics: how an element actually moves, read from its trajectory (`style.trajectory`, sampled
 * every frame as the page came in). Where `motion.ts` compares what a stylesheet DECLARES, this
 * compares what happens — the only way to see a spring, a script-driven entrance, or a
 * transition a class sets going.
 *
 * Each channel (x, y, width, height, opacity) is reduced to what a person perceives in it:
 *   - how far, and which way it went;
 *   - how long until it came to rest (within 2% of where it ended);
 *   - whether it overshot and swung back, and how many times (a spring), or stopped dead;
 *   - for a move that did not overshoot, its curve: how far along it was halfway through its
 *     time (an ease-out is most of the way there; an even, linear move is half way).
 *
 * A move that overshoots is fitted as a damped spring from its overshoot and the time to its
 * peak (the standard second-order response): ζ = −ln(OS)/√(π² + ln²OS), ω₀ = π / (t_peak·√(1−ζ²)).
 * Stiffness ω₀² and damping 2ζω₀ are per unit mass — the numbers Framer Motion and
 * react-spring take — so a finding can say "stiffness ≈ 230, damping ≈ 15" instead of "bouncier".
 *
 * Tolerances are perceptual: durations differ beyond 100ms and 25%; an overshoot is a spring
 * above 5% and stopping dead below 2%; distances differ beyond 8px and 30%.
 */
import type { Trajectory } from '@usefaithful/spec';

export type Channel = 'x' | 'y' | 'w' | 'h' | 'o';
const CHANNELS: Channel[] = ['y', 'x', 'w', 'h', 'o'];
const NOISE: Record<Channel, number> = { x: 2, y: 2, w: 2, h: 2, o: 0.05 };

export interface Spring {
  /** Damping ratio: below 1 it swings; the lower, the more it swings. */
  zeta: number;
  /** Natural frequency, rad/s. */
  omega: number;
  /** Per unit mass, as spring libraries take them. */
  stiffness: number;
  damping: number;
}

export interface ChannelMove {
  channel: Channel;
  /** Signed distance from where it began to where it came to rest (px, or opacity). */
  distance: number;
  /** ms from the first frame it moved to the frame it came to rest. */
  duration: number;
  /** How far past its end it went, as a fraction of the distance (0 when it did not). */
  overshoot: number;
  /** Times it crossed its end point after first reaching it. */
  swings: number;
  /** Progress (0..1) halfway through its time: ~0.5 even, higher decelerating, lower accelerating. */
  halfway: number;
  spring?: Spring;
  /** It moved and came back to where it began (a shake, a pulse): `distance` is then its peak. */
  returns?: boolean;
}

export interface Movement {
  /** When it began moving, ms from the page's first frame. */
  start: number;
  moves: ChannelMove[];
}

/** Fit a damped spring to an overshoot (fraction) and the time of its first peak (ms). */
export function fitSpring(overshoot: number, peakMs: number): Spring | undefined {
  if (!(overshoot > 0 && overshoot < 1) || !(peakMs > 0)) return undefined;
  const l = Math.log(overshoot);
  const zeta = -l / Math.sqrt(Math.PI ** 2 + l ** 2);
  const omega = Math.PI / ((peakMs / 1000) * Math.sqrt(1 - zeta ** 2));
  return { zeta, omega, stiffness: omega ** 2, damping: 2 * zeta * omega };
}

const at = (t: number[], v: number[], x: number): number => {
  for (let i = 1; i < t.length; i++) {
    const t0 = t[i - 1] as number;
    const t1 = t[i] as number;
    if (x <= t1) {
      const v0 = v[i - 1] as number;
      const v1 = v[i] as number;
      return t1 === t0 ? v1 : v0 + ((v1 - v0) * (x - t0)) / (t1 - t0);
    }
  }
  return v[v.length - 1] as number;
};

/** One channel's move, or null when it did not move beyond noise. Times relative to `begin`. */
export function analyseChannel(channel: Channel, t: number[], v: number[]): ChannelMove | null {
  if (t.length < 2 || t.length !== v.length) return null;
  const noise = NOISE[channel];
  const v0 = v[0] as number;
  const v1 = v[v.length - 1] as number;
  const range = Math.max(...v) - Math.min(...v);
  if (range < noise) return null;
  // The recorder keeps a frame only when something changed, so the first kept frame can sit
  // long before the move (an animation waiting out its delay): the move began one frame before
  // the first change.
  const first = v.findIndex((x) => Math.abs(x - v0) > 1e-9);
  const begin = Math.max(t[0] as number, (t[Math.max(first, 1)] as number) - 17);
  const tt = t.map((x) => Math.max(0, x - begin));
  const d = v1 - v0;
  if (Math.abs(d) < noise) {
    // There and back: its size is the furthest it got, its time the last frame away from home.
    let peak = 0;
    let last = 0;
    v.forEach((x, i) => {
      if (Math.abs(x - v0) > Math.abs(peak)) peak = x - v0;
      if (Math.abs(x - v0) > noise / 2) last = tt[i] as number;
    });
    return {
      channel,
      distance: peak,
      duration: Math.round(last),
      overshoot: 0,
      swings: 0,
      halfway: 0.5,
      returns: true,
    };
  }
  const p = v.map((x) => (x - v0) / d);
  let settle = tt.length - 1;
  while (settle > 0 && Math.abs((p[settle - 1] as number) - 1) <= 0.02) settle--;
  const duration = tt[settle] as number;
  let peakI = 0;
  p.forEach((x, i) => {
    if (x > (p[peakI] as number)) peakI = i;
  });
  // The peak falls between frames: a parabola through the three frames around it puts it
  // where it was, so a 60fps sample does not snap the time to peak by up to 8ms (±10% on ω₀).
  let peakT = tt[peakI] as number;
  let peakP = p[peakI] as number;
  if (peakI > 0 && peakI < p.length - 1) {
    const [x0, x1, x2] = [tt[peakI - 1], tt[peakI], tt[peakI + 1]] as [number, number, number];
    const [y0, y1, y2] = [p[peakI - 1], p[peakI], p[peakI + 1]] as [number, number, number];
    const den = (x1 - x0) * (y1 - y2) - (x1 - x2) * (y1 - y0);
    if (den !== 0 && y1 > y0 && y1 > y2) {
      const xv = x1 - 0.5 * (((x1 - x0) ** 2 * (y1 - y2) - (x1 - x2) ** 2 * (y1 - y0)) / den);
      if (xv > x0 && xv < x2) {
        const yv =
          (y0 * (xv - x1) * (xv - x2)) / ((x0 - x1) * (x0 - x2)) +
          (y1 * (xv - x0) * (xv - x2)) / ((x1 - x0) * (x1 - x2)) +
          (y2 * (xv - x0) * (xv - x1)) / ((x2 - x0) * (x2 - x1));
        peakT = xv;
        peakP = Math.max(peakP, yv);
      }
    }
  }
  const overshoot = Math.max(0, peakP - 1);
  // Swings: crossings of the end point, counting only excursions beyond 2%.
  let swings = 0;
  let side = 0;
  let reached = false;
  for (const x of p) {
    if (!reached && x >= 1) reached = true;
    if (!reached) continue;
    const s = x > 1.02 ? 1 : x < 0.98 ? -1 : 0;
    if (s && side && s !== side) swings++;
    if (s) side = s;
  }
  if (overshoot > 0.02) swings++;
  const halfway = duration > 0 ? at(tt, p, duration / 2) : 1;
  const move: ChannelMove = {
    channel,
    distance: d,
    duration: Math.round(duration),
    overshoot: Math.round(overshoot * 1000) / 1000,
    swings,
    halfway: Math.round(halfway * 100) / 100,
  };
  // A spring starts from rest, so it leaves its start as the square of the time since it
  // began: a parabola through its first three frames has its vertex where it began. The first
  // sample alone can be a whole frame late, which would put the stiffness up to 18% high.
  let springStart = 0;
  if (p.length >= 3) {
    const [a0, a1, a2] = [tt[0], tt[1], tt[2]] as [number, number, number];
    const [b0, b1, b2] = [p[0], p[1], p[2]] as [number, number, number];
    // Divided differences: p ≈ b0 + c1(t − a0) + c2(t − a0)(t − a1).
    const c1 = (b1 - b0) / (a1 - a0 || 1);
    const c2 = ((b2 - b1) / (a2 - a1 || 1) - c1) / (a2 - a0 || 1);
    if (c2 > 0) {
      const vertex = (a0 + a1) / 2 - c1 / (2 * c2);
      springStart = Math.min(a1, Math.max(a0 - 17, vertex));
    }
  }
  const spring = overshoot > 0.02 ? fitSpring(overshoot, peakT - springStart) : undefined;
  if (spring) move.spring = spring;
  return move;
}

/** Everything an element did as the page came in. */
export function analyseTrajectory(tr: Trajectory): Movement {
  const moves: ChannelMove[] = [];
  for (const c of CHANNELS) {
    const m = analyseChannel(c, tr.t, tr[c]);
    if (m) moves.push(m);
  }
  return { start: tr.start, moves };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

const WAY: Record<Channel, [string, string]> = {
  x: ['left', 'right'],
  y: ['up', 'down'],
  w: ['narrower', 'wider'],
  h: ['shorter', 'taller'],
  o: ['out', 'in'],
};
const way = (c: Channel, d: number) => WAY[c][d < 0 ? 0 : 1];
const size = (c: Channel, d: number) => (c === 'o' ? pct(Math.abs(d)) : `${Math.round(Math.abs(d))}px`);

const WHAT: Record<Channel, (d: number) => string> = {
  x: (d) => `moves ${d < 0 ? 'left' : 'right'} ${Math.round(Math.abs(d))}px`,
  y: (d) => `moves ${d < 0 ? 'up' : 'down'} ${Math.round(Math.abs(d))}px`,
  w: (d) => `${d < 0 ? 'narrows' : 'widens'} ${Math.round(Math.abs(d))}px`,
  h: (d) => `${d < 0 ? 'shortens' : 'grows'} ${Math.round(Math.abs(d))}px`,
  o: (d) => `fades ${d < 0 ? 'out' : 'in'} ${pct(Math.abs(d))}`,
};

/** How it moves, in words: "the curve" a designer would name. */
export function feel(m: ChannelMove): string {
  if (m.returns) return 'and comes back';
  if (m.spring && m.overshoot > 0.05)
    return `with a spring (overshoots ${pct(m.overshoot)}, ${m.swings} swing${m.swings === 1 ? '' : 's'}; stiffness ≈ ${Math.round(m.spring.stiffness)}, damping ≈ ${Math.round(m.spring.damping)})`;
  if (m.halfway >= 0.65) return 'decelerating (ease-out)';
  if (m.halfway <= 0.35) return 'accelerating (ease-in)';
  return 'evenly';
}

export const describeMove = (m: ChannelMove): string =>
  `${WHAT[m.channel](m.distance)}${m.returns ? '' : ` over ${m.duration}ms`} ${feel(m)}`;

const sameDuration = (a: number, b: number) => Math.abs(a - b) <= Math.max(100, 0.25 * Math.max(a, b));
const sameDistance = (c: Channel, a: number, b: number) =>
  c === 'o' ? Math.abs(a - b) <= 0.15 : Math.abs(a - b) <= Math.max(8, 0.3 * Math.max(Math.abs(a), Math.abs(b)));
const springy = (m: ChannelMove) => m.overshoot > 0.05;
const dead = (m: ChannelMove) => m.overshoot < 0.02;

/** What differs between how a design element moved in and how its build did; empty when none. */
export function physicsDiff(
  d: Trajectory | undefined,
  b: Trajectory | undefined,
): { severity: 'error' | 'warn' | 'info'; detail: string }[] {
  const dm = d ? analyseTrajectory(d).moves : [];
  const bm = b ? analyseTrajectory(b).moves : [];
  const out: { severity: 'error' | 'warn' | 'info'; detail: string }[] = [];
  for (const x of dm) {
    const y = bm.find((m) => m.channel === x.channel);
    if (!y) {
      // A movement the design makes and the build does not is a missing behaviour.
      out.push({ severity: 'error', detail: `on entry the design ${describeMove(x)}; the build does not` });
      continue;
    }
    const parts: string[] = [];
    if (!x.returns && !y.returns && Math.sign(x.distance) !== Math.sign(y.distance))
      parts.push(`${way(x.channel, x.distance)} in the design, ${way(y.channel, y.distance)} in the build`);
    else if (!x.returns && !y.returns && !sameDistance(x.channel, x.distance, y.distance))
      parts.push(`${size(x.channel, x.distance)} → ${size(y.channel, y.distance)}`);
    if (!x.returns && !y.returns && !sameDuration(x.duration, y.duration))
      parts.push(`${x.duration}ms → ${y.duration}ms`);
    if (springy(x) && dead(y))
      parts.push(`the design springs ${feel(x).replace(/^with a spring /, '')}; the build stops dead`);
    else if (dead(x) && springy(y))
      parts.push(`the build springs (overshoots ${pct(y.overshoot)}); the design stops dead`);
    else if (springy(x) && springy(y) && Math.abs(x.overshoot - y.overshoot) > 0.08)
      parts.push(`overshoot ${pct(x.overshoot)} → ${pct(y.overshoot)}`);
    else if (dead(x) && dead(y) && !x.returns && !y.returns && Math.abs(x.halfway - y.halfway) > 0.2)
      parts.push(`${feel(x)} → ${feel(y)}`);
    if (parts.length)
      out.push({ severity: 'warn', detail: `on entry, ${CHANNEL_NAME[x.channel]}: ${parts.join('; ')}` });
  }
  for (const y of bm)
    if (!dm.some((m) => m.channel === y.channel))
      out.push({ severity: 'warn', detail: `on entry the build ${describeMove(y)}; the design is still` });
  // When it starts is the page's load as much as the design's: said, never failed.
  if (d && b && dm.length && bm.length && Math.abs(d.start - b.start) > Math.max(250, 0.5 * Math.max(d.start, b.start)))
    out.push({
      severity: 'info',
      detail: `on entry it starts at ${Math.round(d.start)}ms in the design, ${Math.round(b.start)}ms in the build`,
    });
  return out;
}

const CHANNEL_NAME: Record<Channel, string> = {
  x: 'horizontal movement',
  y: 'vertical movement',
  w: 'width',
  h: 'height',
  o: 'opacity',
};
