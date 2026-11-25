/**
 * Design sense, as arithmetic. With no design file, a page still states its own system — a
 * body size and the ratio its headings grow by, the unit its spacing is counted in, the edges
 * its columns share — and a value that misses that system by a little is the tell of a value
 * typed by eye. Each check FITS the system the page uses (it never imposes one), and reports
 * only the values that miss it, with the value that would fit. An agent gets a number to use,
 * not an opinion.
 *
 *  - Type scale: sizes as base·rⁿ (Bringhurst's modular scale; the ratios are the musical
 *    intervals typographers name). The fit is the LARGEST classical ratio that places ≥ 80% of
 *    the page's text, and ≥ 60% of its distinct sizes, on a step; a step's window is a fixed
 *    share of the step, so a random size fits by chance ~30% of the time at every ratio; and
 *    the fit must beat chance (binomial tail ≤ 5%), or no scale is claimed.
 *  - Spacing: the largest unit (8 with its 4px half-step, 6, 5, 4) dividing ≥ 80% of the
 *    page's padding, margin and gap values, weighted by use, beating chance; a value off it
 *    used once or twice is a slip, one used often is a decision and is left alone.
 *  - Alignment: left edges that miss an edge four or more elements share, by 1.5–4px, in the
 *    same band of the page. Further than 4px is a different column; under 1.5px is rounding.
 *  - Hierarchy: a heading level drawn larger than the level above it reads out of order.
 */

export interface ScaleFit {
  ratio: number;
  name: string;
  base: number;
  /** Share of the text (by use) on a step. */
  coverage: number;
  /** Sizes off the scale, with the steps either side. */
  off: { size: number; n: number; below: number; above: number }[];
}

export const RATIOS: [number, string][] = [
  [1.618, 'golden ratio'],
  [1.5, 'perfect fifth'],
  [Math.SQRT2, 'augmented fourth'],
  [1.333, 'perfect fourth'],
  [1.25, 'major third'],
  [1.2, 'minor third'],
];
// Not the major second (1.125): eight steps an octave place a step within reach of almost any
// size, so "follows 1.125" says nothing a reader could act on.

const r1 = (x: number) => Math.round(x * 10) / 10;

/** P(X ≥ k) for X ~ Binomial(n, p). */
export function binomialTail(n: number, k: number, p: number): number {
  let sum = 0;
  for (let i = k; i <= n; i++) {
    let c = 1;
    for (let j = 0; j < i; j++) c = (c * (n - j)) / (j + 1);
    sum += c * p ** i * (1 - p) ** (n - i);
  }
  return Math.min(1, sum);
}

/** The modular scale the sizes follow, or null when none places most of the text. */
export function fitTypeScale(sizes: [number, number][]): ScaleFit | null {
  const use = sizes.filter(([s, n]) => s >= 8 && s <= 160 && n > 0);
  if (use.length < 4) return null;
  // The base is the body: the most-used size between 12 and 22px.
  const body = use.filter(([s]) => s >= 12 && s <= 22).sort((a, b) => b[1] - a[1])[0];
  if (!body) return null;
  const base = body[0];
  const total = use.reduce((t, [, n]) => t + n, 0);
  for (const [ratio, name] of RATIOS) {
    const step = (s: number) => Math.round(Math.log(s / base) / Math.log(ratio));
    // On a step: within 15% of a step's width (capped at 5%), or 0.6px of rounding. A share of
    // the step, so every ratio is held to the same sensitivity (a fixed ±4% would make 1.125
    // accept 67% of random sizes); what guards against a fit by chance is the binomial test
    // below, which takes its p from this same window.
    const tol = Math.min(0.15 * Math.log(ratio), Math.log(1.05));
    const on = (s: number) => {
      const pred = base * ratio ** step(s);
      return Math.abs(Math.log(s / pred)) <= tol || Math.abs(s - pred) <= 0.6;
    };
    const covered = use.filter(([s]) => on(s)).reduce((t, [, n]) => t + n, 0) / total;
    // Most of the text, AND most of the distinct sizes: a page of body text and three random
    // headings is not following anything.
    const distinct = use.filter(([s]) => on(s)).length / use.length;
    if (covered < 0.8 || distinct < 0.6) continue;
    // And more than chance: the probability that this many of the other sizes would land on a
    // step at random (binomial, each landing with p = the window's share of a step) must be
    // 5% or less. Three sizes, two on steps, is a coincidence one time in five.
    const others = use.filter(([s]) => s !== base);
    const hits = others.filter(([s]) => on(s)).length;
    const p = Math.min(1, (2 * tol) / Math.log(ratio));
    if (binomialTail(others.length, hits, p) > 0.05) continue;
    // The fix is a size the page ALREADY uses on the scale, never a computed decimal: a design
    // system is a list of tokens, and 22.8px is nobody's token.
    const onSizes = use.filter(([s]) => on(s)).map(([s]) => s);
    const off = use
      .filter(([s, n]) => !on(s) && n <= Math.max(2, total * 0.02))
      .map(([size, n]) => {
        const below = Math.max(...onSizes.filter((x) => x < size), 0);
        const above = Math.min(...onSizes.filter((x) => x > size), Number.POSITIVE_INFINITY);
        return { size, n, below: below || r1(base / ratio), above: Number.isFinite(above) ? above : r1(size * ratio) };
      });
    return { ratio, name, base, coverage: covered, off };
  }
  return null;
}

export interface GridFit {
  unit: number;
  coverage: number;
  off: { value: number; n: number; below: number; above: number; sel?: string }[];
}

/** The spacing grid the page counts in, or null when none covers most of it. */
export function fitSpacingGrid(values: [number, number, string?][]): GridFit | null {
  const use = values.filter(([v, n]) => v > 2 && v <= 256 && n > 0);
  const total = use.reduce((t, [, n]) => t + n, 0);
  if (use.length < 5 || total < 12) return null;
  for (const unit of [8, 6, 5, 4]) {
    // An 8px grid keeps 4px as its half-step (the "8-point grid" as practised); others do not.
    const step = unit === 8 ? 4 : unit;
    const fits = (v: number) => Math.abs(v / step - Math.round(v / step)) * step <= 0.5;
    const coverage = use.filter(([v]) => fits(v)).reduce((t, [, n]) => t + n, 0) / total;
    if (coverage < 0.8) continue;
    // The half-step is an exception, not a rhythm: when 12, 20, 28… are common the page counts
    // in fours, and is a 4px grid.
    if (unit === 8) {
      const odd = use.filter(([v]) => v > 4 && fits(v) && Math.round(v / 4) % 2 === 1).reduce((t, [, n]) => t + n, 0);
      if (odd / total > 0.2) continue;
    }
    // More than chance: a whole-pixel value is a multiple of the unit one time in `unit`.
    const hits = use.filter(([v]) => fits(v)).length;
    if (binomialTail(use.length, hits, 1 / step) > 0.05) continue;
    // A value used again and again off the grid is a decision (a 6px button padding across a
    // design system); one used once or twice is a slip. The fix is the grid's own steps.
    const off = use
      .filter(([v, n]) => !fits(v) && n <= 2)
      .map(([value, n, sel]) => ({
        value,
        n,
        below: Math.max(Math.floor(value / step) * step, step),
        above: Math.ceil(value / step) * step,
        ...(sel ? { sel } : {}),
      }));
    return { unit, coverage, off };
  }
  return null;
}

export interface Edge {
  x: number;
  y: number;
  h: number;
  sel: string;
}

/** Left edges that nearly share an edge many elements share: 1–4px off, in the same band. */
export function nearMissEdges(edges: Edge[]): { sel: string; x: number; to: number; shared: number; by: number }[] {
  const byX = new Map<number, Edge[]>();
  for (const e of edges) {
    const k = Math.round(e.x);
    byX.set(k, [...(byX.get(k) ?? []), e]);
  }
  const lines = [...byX].filter(([, es]) => es.length >= 4).sort((a, b) => b[1].length - a[1].length);
  const out: { sel: string; x: number; to: number; shared: number; by: number }[] = [];
  const used = new Set<Edge>();
  for (const [x, members] of lines) {
    const top = Math.min(...members.map((m) => m.y));
    const bottom = Math.max(...members.map((m) => m.y + m.h));
    for (const e of edges) {
      if (used.has(e)) continue;
      // Under 1.5px is sub-pixel rounding; over 4px is a different column.
      const d = Math.abs(e.x - x);
      if (d < 1.5 || d > 4) continue;
      // A line that is itself well used is a column of its own, not a slip.
      if ((byX.get(Math.round(e.x))?.length ?? 0) >= 3) continue;
      // In the column's band: from just above its first member to just below its last (a slip
      // is often the paragraph right after a column; a footer far down is another band).
      if (e.y + e.h < top - 240 || e.y > bottom + 240) continue;
      used.add(e);
      out.push({ sel: e.sel, x: Math.round(e.x), to: x, shared: members.length, by: Math.round(d) });
    }
  }
  return out.slice(0, 6);
}

/**
 * Headings drawn out of order: one drawn larger than the typical heading of the level above it
 * (the median, so one odd heading up there does not move the bar), by more than rounding.
 */
export function hierarchyInversions(
  headings: { level: number; size?: number; sel: string }[],
): { upper: number; lower: number; upperPx: number; lowerPx: number; sel: string }[] {
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor((s.length - 1) / 2)] as number;
  };
  const sizes = new Map<number, number[]>();
  for (const h of headings) if (h.size) sizes.set(h.level, [...(sizes.get(h.level) ?? []), h.size]);
  const out: { upper: number; lower: number; upperPx: number; lowerPx: number; sel: string }[] = [];
  for (const h of headings) {
    if (!h.size) continue;
    const upper = [...sizes.keys()].filter((l) => l < h.level).sort((a, b) => b - a)[0];
    if (upper === undefined) continue;
    const upx = median(sizes.get(upper) as number[]);
    if (h.size > upx * 1.1 && h.size - upx >= 2)
      out.push({ upper, lower: h.level, upperPx: upx, lowerPx: h.size, sel: h.sel });
  }
  return out.slice(0, 3);
}
