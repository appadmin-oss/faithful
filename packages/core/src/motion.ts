/**
 * Motion compared as a design specifies it: for each element, which properties move, for how
 * long, along which curve, after which delay, how many times. A design's motion is part of the
 * design (owner, 24 Nov 2026: "physics, motion, behaviours … it is all a part of the design").
 *
 * Tolerances are perceptual, not exact: two durations differ when they differ by more than
 * 50ms and 20% (a 300ms and a 320ms fade are the same fade); two easings differ when a control
 * point of their cubic-bézier moves by more than 0.1 (ease-out vs linear does; two near-
 * identical custom curves do not).
 */
import type { Motion, MotionTrack } from '@usefaithful/spec';

/** Keyword easings as the cubic-béziers CSS defines them. */
const KEYWORDS: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

export function bezierOf(easing: string): [number, number, number, number] | null {
  const e = easing.trim().toLowerCase();
  if (KEYWORDS[e]) return KEYWORDS[e];
  const m = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(e);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : null;
}

/** Two easings are the same curve (within 0.1 per control point; other functions by text). */
export function sameEasing(a: string, b: string): boolean {
  const x = bezierOf(a);
  const y = bezierOf(b);
  if (x && y) return x.every((v, i) => Math.abs(v - (y[i] as number)) <= 0.1);
  return a.replace(/\s+/g, '') === b.replace(/\s+/g, '');
}

export const sameTime = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(50, 0.2 * Math.max(a, b));

/** Properties whose change MOVES something (rather than fading or recolouring it). */
export const MOVEMENT =
  /^(all|transform|translate|rotate|scale|top|left|right|bottom|inset.*|margin.*|width|height|max-height|grid-template-.*|offset-.*)$/;

const describe = (t: MotionTrack) =>
  `${t.property} ${t.duration}ms ${t.easing}${t.delay ? ` +${t.delay}ms` : ''}${t.iterations && t.iterations !== '1' ? ` ×${t.iterations}` : ''}`;

/** What differs between a design element's motion and its build's, in words; empty when none. */
export function motionDiff(
  d: Motion | undefined,
  b: Motion | undefined,
): { severity: 'error' | 'warn' | 'info'; detail: string }[] {
  const dm: Motion = d ?? { transitions: [], animations: [], scripted: [] };
  const bm: Motion = b ?? { transitions: [], animations: [], scripted: [] };
  // Motion the design has and the build lacks is a missing behaviour (an error, like a missing
  // element); different timing, or movement the design does not have, is a warning.
  const out: { severity: 'error' | 'warn' | 'info'; detail: string }[] = [];
  const timing = (x: MotionTrack, y: MotionTrack, what: string) => {
    const parts: string[] = [];
    if (!sameTime(x.duration, y.duration)) parts.push(`${x.duration}ms → ${y.duration}ms`);
    if (!sameEasing(x.easing, y.easing)) parts.push(`${x.easing} → ${y.easing}`);
    if (Math.abs(x.delay - y.delay) > 50) parts.push(`delay ${x.delay}ms → ${y.delay}ms`);
    if ((x.iterations ?? '1') !== (y.iterations ?? '1'))
      parts.push(`×${x.iterations ?? '1'} → ×${y.iterations ?? '1'}`);
    if (parts.length) out.push({ severity: 'warn', detail: `${what}: ${parts.join(', ')}` });
  };
  // Transitions, by property; `all` stands for any.
  const used = new Set<MotionTrack>();
  for (const x of dm.transitions) {
    const y =
      bm.transitions.find((t) => !used.has(t) && t.property === x.property) ??
      bm.transitions.find((t) => !used.has(t) && (t.property === 'all' || x.property === 'all'));
    if (!y) {
      out.push({ severity: 'error', detail: `the design moves ${describe(x)}; the build does not` });
      continue;
    }
    used.add(y);
    timing(x, y, `${x.property} transition`);
  }
  for (const y of bm.transitions)
    if (!used.has(y))
      out.push({
        severity: MOVEMENT.test(y.property) ? 'warn' : 'info',
        detail: `the build moves ${describe(y)}; the design does not`,
      });
  // Animations (CSS and scripted together: a design's keyframes may be a build's script), by
  // what their keyframes change, then by order. Names are the author's, never compared.
  const da = [...dm.animations, ...dm.scripted];
  const ba = [...bm.animations, ...bm.scripted];
  const takenB = new Set<MotionTrack>();
  for (const x of da) {
    const key = (x.keyframes ?? []).join(',');
    const y =
      ba.find((t) => !takenB.has(t) && key && (t.keyframes ?? []).join(',') === key) ?? ba.find((t) => !takenB.has(t));
    if (!y) {
      out.push({ severity: 'error', detail: `the design animates (${describe(x)}); the build is still` });
      continue;
    }
    takenB.add(y);
    timing(x, y, `animation${x.keyframes?.length ? ` of ${x.keyframes.join(', ')}` : ''}`);
  }
  for (const y of ba)
    if (!takenB.has(y))
      out.push({ severity: 'warn', detail: `the build animates (${describe(y)}); the design is still` });
  return out;
}
