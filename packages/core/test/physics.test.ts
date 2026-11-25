import type { Trajectory } from '@usefaithful/spec';
import { describe, expect, it } from 'vitest';
import { analyseChannel, analyseTrajectory, fitSpring, physicsDiff } from '../src/physics.js';

/** A trajectory sampled at 60fps from a function of time (ms) to progress, moving `dy` px down. */
function track(fn: (t: number) => number, ms: number, dy = 40, fade = false): Trajectory {
  const t: number[] = [];
  for (let x = 0; x <= ms; x += 1000 / 60) t.push(Math.round(x));
  const p = t.map(fn);
  return {
    start: 100,
    t,
    x: t.map(() => 10),
    y: p.map((v) => 200 + dy * v),
    w: t.map(() => 300),
    h: t.map(() => 50),
    o: fade ? p.map((v) => Math.min(1, Math.max(0, v))) : t.map(() => 1),
  };
}

/** An underdamped spring's step response: the curve Framer Motion and react-spring draw. */
const spring = (zeta: number, omega: number) => (ms: number) => {
  const t = ms / 1000;
  const wd = omega * Math.sqrt(1 - zeta ** 2);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
};
const linear = (ms: number) => (d: number) => Math.min(1, d / ms);
const easeOut = (ms: number) => (d: number) => 1 - (1 - Math.min(1, d / ms)) ** 3;

describe('reading a trajectory', () => {
  it('fits a spring back to its own stiffness and damping', () => {
    const m = analyseTrajectory(track(spring(0.4, 18), 1500)).moves.find((x) => x.channel === 'y');
    expect(m?.spring?.zeta).toBeGreaterThan(0.36);
    expect(m?.spring?.zeta).toBeLessThan(0.44);
    // ω₀ 18 rad/s is stiffness 324 per unit mass; within a frame's error of the peak.
    expect(m?.spring?.stiffness).toBeGreaterThan(324 * 0.85);
    expect(m?.spring?.stiffness).toBeLessThan(324 * 1.15);
    expect(m?.overshoot).toBeGreaterThan(0.2);
    expect(m?.swings).toBeGreaterThanOrEqual(2);
  });

  it('the fit does not depend on where the frames happened to fall', () => {
    // The same spring sampled at 60fps from four phases: snapping the peak to a frame would move
    // the time to peak by up to 8ms, and timing it from the first sample puts it up to a frame
    // late; either moves the stiffness by up to 18%.
    const f = spring(0.4, 18);
    for (const phase of [0, 4, 8, 12]) {
      const t: number[] = [];
      for (let x = phase; x <= 1500; x += 1000 / 60) t.push(x - phase);
      const m = analyseChannel(
        'y',
        t,
        t.map((x) => 200 + 40 * f(x + phase)),
      );
      expect(Math.abs((m?.spring?.stiffness ?? 0) / 324 - 1)).toBeLessThan(0.1);
      // …and as the recorder usually sees it: a still frame, then the move, begun mid-frame.
      const s = phase + 3;
      const still = analyseChannel(
        'y',
        t,
        t.map((x) => 200 + 40 * (x < s ? 0 : f(x - s))),
      );
      expect(Math.abs((still?.spring?.stiffness ?? 0) / 324 - 1)).toBeLessThan(0.1);
    }
  });

  it('the fit is the textbook one', () => {
    const s = fitSpring(
      Math.exp((-0.5 * Math.PI) / Math.sqrt(1 - 0.25)),
      (Math.PI / (10 * Math.sqrt(1 - 0.25))) * 1000,
    );
    expect(s?.zeta).toBeCloseTo(0.5, 5);
    expect(s?.omega).toBeCloseTo(10, 5);
    expect(fitSpring(0, 100)).toBeUndefined();
  });

  it('times a move to rest and names its curve', () => {
    const lin = analyseChannel('y', ...cols(track(linear(400), 600)));
    const out = analyseChannel('y', ...cols(track(easeOut(400), 600)));
    expect(lin?.duration).toBeGreaterThan(370);
    expect(lin?.duration).toBeLessThan(420);
    expect(lin?.halfway).toBeCloseTo(0.5, 1);
    expect(out?.halfway).toBeGreaterThan(0.65);
    expect(lin?.overshoot).toBe(0);
  });

  it('measures from when it began, not from when the recorder first saw it', () => {
    // Held still for 300ms (an animation waiting out its delay), then a 400ms linear move.
    const tr = track((t) => (t < 300 ? 0 : Math.min(1, (t - 300) / 400)), 900);
    const keep = tr.t.map((_, i) => i === 0 || tr.y[i] !== tr.y[i - 1]);
    const pick = (a: number[]) => a.filter((_, i) => keep[i]);
    const m = analyseChannel('y', pick(tr.t), pick(tr.y));
    expect(m?.duration).toBeGreaterThan(370);
    expect(m?.duration).toBeLessThan(430);
  });

  it('noise is not movement', () => {
    expect(analyseChannel('y', [0, 16, 33], [200, 200.5, 201])).toBeNull();
    expect(analyseChannel('o', [0, 16, 33], [1, 0.98, 1])).toBeNull();
  });

  it('a move that comes back is a return, sized by how far it got', () => {
    const m = analyseChannel(
      'x',
      ...cols(
        track((t) => Math.sin((Math.PI * Math.min(t, 300)) / 300), 400),
        'x',
        30,
      ),
    );
    expect(m?.returns).toBe(true);
    expect(Math.abs(m?.distance ?? 0)).toBeGreaterThan(25);
  });
});

function cols(tr: Trajectory, c: 'x' | 'y' = 'y', dx = 0): [number[], number[]] {
  if (c === 'x') return [tr.t, tr.y.map((v) => ((v - 200) / 40) * dx)];
  return [tr.t, tr.y];
}

describe('comparing how a design and a build move', () => {
  const sprung = track(spring(0.4, 18), 1500, 40, true);
  it('the same movement passes', () => {
    expect(physicsDiff(sprung, track(spring(0.42, 17.5), 1500, 40, true))).toEqual([]);
  });

  it('a spring built as a glide is named, with the spring the design had', () => {
    const out = physicsDiff(sprung, track(easeOut(500), 1500, 40, true));
    const y = out.find((f) => /vertical/.test(f.detail));
    expect(y?.severity).toBe('warn');
    expect(y?.detail).toMatch(
      /the design springs \(overshoots \d+%.*stiffness ≈ \d+, damping ≈ \d+\); the build stops dead/,
    );
  });

  it('a move the build does not make is an error; one the design does not make is a warning', () => {
    const still = track(() => 0, 1500);
    expect(
      physicsDiff(sprung, still)
        .filter((f) => f.severity === 'error')
        .map((f) => f.detail),
    ).toEqual([
      expect.stringMatching(/^on entry the design moves down 40px over \d+ms with a spring/),
      expect.stringMatching(/^on entry the design fades in 100% over \d+ms/),
    ]);
    expect(physicsDiff(undefined, sprung).every((f) => f.severity === 'warn')).toBe(true);
    expect(physicsDiff(undefined, undefined)).toEqual([]);
  });

  it('a different time, distance, direction or curve is said in numbers', () => {
    const d = track(linear(400), 800);
    expect(physicsDiff(d, track(linear(900), 1200))[0]?.detail).toMatch(/vertical movement: \d+ms → \d+ms/);
    expect(physicsDiff(d, track(linear(400), 800, 120))[0]?.detail).toMatch(/40px → 120px/);
    expect(physicsDiff(d, track(linear(400), 800, -40))[0]?.detail).toMatch(/down in the design, up in the build/);
    expect(physicsDiff(d, track(easeOut(400), 800))[0]?.detail).toMatch(/evenly → decelerating \(ease-out\)/);
  });

  it('when it starts is a note, never a failure', () => {
    const late = { ...track(linear(400), 800), start: 1500 };
    const out = physicsDiff(track(linear(400), 800), late);
    expect(out).toEqual([
      { severity: 'info', detail: 'on entry it starts at 100ms in the design, 1500ms in the build' },
    ]);
  });
});
