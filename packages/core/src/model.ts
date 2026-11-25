/**
 * A style model: one product's design system, read off its own running pages, so another product
 * can be judged against it. "Make our admin look like that one" becomes measurable: the reference's
 * text sizes, corner radii, button shapes, colours, spacing grid and title size are pooled across
 * its pages, and each page of the target is held to them.
 *
 * Built from the same facts `audit` measures, never from a screenshot: a value is in the model
 * because the reference USES it (by count), and a value the reference uses once is noise, not
 * system, so each set keeps only what covers most of the reference's use.
 */
import type { AuditFacts } from './audit-facts.js';
import { deltaE } from './color.js';
import { fitSpacingGrid } from './design-sense.js';

export interface StyleModel {
  /** Model format version. */
  v: 1;
  /** The pages it was read from. */
  sources: string[];
  /** Text sizes, px. */
  sizes: number[];
  /** Corner radii above zero, px. */
  radii: number[];
  /** Filled buttons' shapes: corner radius and height, px. */
  buttons: { radius: number; height: number }[];
  /** Colours, hex: text, fills and borders. */
  colors: string[];
  /** Spacing grid, when the reference keeps one. */
  grid?: { unit: number; coverage: number };
  /** Page-title (h1) sizes, px. */
  titles: number[];
  /** The most entries one strip of its menus holds. */
  navMax: number;
}

/** The values covering `share` of all use, most used first (a value used once is not system). */
function covering<T>(counts: Map<T, number>, share: number, minN = 2): T[] {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const out: T[] = [];
  let run = 0;
  for (const [v, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    if (run >= total * share || n < minN) break;
    out.push(v);
    run += n;
  }
  return out;
}

const bump = <T>(m: Map<T, number>, k: T, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const half = (v: number) => Math.round(v * 2) / 2;

/** Pool a reference's pages into its model. Desktop pages only: a phone fills the width by rule. */
export function buildModel(pages: { source: string; facts: AuditFacts }[]): StyleModel {
  const sizes = new Map<number, number>();
  const radii = new Map<number, number>();
  const buttons = new Map<string, number>();
  const colors = new Map<string, number>();
  const titles = new Map<number, number>();
  const spacing = new Map<number, [number, string]>();
  let navMax = 0;
  for (const { facts: f } of pages) {
    for (const [s, n] of f.palette?.sizes ?? []) bump(sizes, half(s), n);
    for (const [r, n] of f.palette?.radii ?? []) if (r > 0 && r < 999) bump(radii, half(r), n);
    for (const b of f.palette?.buttons ?? []) bump(buttons, `${Math.round(b.radius)}:${Math.round(b.height)}`);
    for (const [c, n] of f.palette?.colors ?? []) bump(colors, c.toLowerCase(), n);
    for (const h of f.headings) if (h.level === 1 && h.size) bump(titles, half(h.size));
    for (const [v, n, sel] of f.spacing ?? []) {
      const e = spacing.get(v);
      spacing.set(v, [(e?.[0] ?? 0) + n, e?.[1] ?? sel]);
    }
    for (const nav of f.navs ?? []) navMax = Math.max(navMax, nav.strip);
  }
  const grid = fitSpacingGrid([...spacing].map(([v, [n, sel]]) => [v, n, sel] as [number, number, string]));
  return {
    v: 1,
    sources: pages.map((p) => p.source),
    sizes: covering(sizes, 0.97).sort((a, b) => a - b),
    radii: covering(radii, 0.95).sort((a, b) => a - b),
    buttons: covering(buttons, 0.95, 1).map((k) => {
      const [radius, height] = k.split(':').map(Number) as [number, number];
      return { radius, height };
    }),
    colors: covering(colors, 0.95),
    ...(grid ? { grid: { unit: grid.unit, coverage: Math.round(grid.coverage * 100) / 100 } } : {}),
    titles: [...titles.keys()].sort((a, b) => a - b),
    navMax,
  };
}

export interface ModelFinding {
  severity: 'warn' | 'info';
  kind: 'scale' | 'radius' | 'palette' | 'consistency' | 'navigation';
  detail: string;
  sel?: string;
}

const near = (list: number[], v: number, tol: number) => list.some((x) => Math.abs(x - v) <= tol);
const nearest = (list: number[], v: number) =>
  list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), list[0] as number);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 100);
const px = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}px`;

/**
 * Hold one page to a model. Each measure is the share of the page's USE that is on the model,
 * so one stray value on a page of hundreds is a note and a page drawn from another system is a
 * warning. Returns the findings and a one-line score per measure.
 */
export function judgeAgainstModel(
  f: AuditFacts,
  m: StyleModel,
): { findings: ModelFinding[]; measures: Record<string, number> } {
  const findings: ModelFinding[] = [];
  const measures: Record<string, number> = {};
  const name = m.sources.length === 1 ? m.sources[0] : `${m.sources.length} reference pages`;
  const judge = <T>(
    key: string,
    items: [T, number][],
    on: (v: T) => boolean,
    say: (off: [T, number][], share: number) => Omit<ModelFinding, 'severity'>,
  ) => {
    const total = items.reduce((a, [, n]) => a + n, 0);
    if (!total) return;
    const off = items.filter(([v]) => !on(v)).sort((a, b) => b[1] - a[1]);
    const share = pct(total - off.reduce((a, [, n]) => a + n, 0), total);
    measures[key] = share;
    if (off.length) findings.push({ severity: share < 80 ? 'warn' : 'info', ...say(off, share) });
  };

  if (m.sizes.length)
    judge(
      'type',
      f.palette?.sizes ?? [],
      (s) => near(m.sizes, s, 0.5),
      (off, share) => ({
        kind: 'scale',
        detail: `${share}% of the text is on the model's sizes (${m.sizes.map(px).join(', ')}); off it: ${off
          .slice(0, 3)
          .map(([s, n]) => `${px(s)} ×${n} → ${px(nearest(m.sizes, s))}`)
          .join(', ')}`,
      }),
    );
  if (m.radii.length)
    judge(
      'radius',
      (f.palette?.radii ?? []).filter(([r]) => r > 0 && r < 999),
      (r) => near(m.radii, r, 0.5),
      (off, share) => ({
        kind: 'radius',
        detail: `${share}% of the corners use the model's radii (${m.radii.map(px).join(', ')}); off it: ${off
          .slice(0, 3)
          .map(([r, n]) => `${px(r)} ×${n} → ${px(nearest(m.radii, r))}`)
          .join(', ')}`,
      }),
    );
  if (m.buttons.length) {
    const shapes = new Map<string, number>();
    const example = new Map<string, string>();
    for (const b of f.palette?.buttons ?? []) {
      const k = `${Math.round(b.radius)}:${Math.round(b.height)}`;
      bump(shapes, k);
      if (!example.has(k)) example.set(k, b.text || b.sel);
    }
    const fits = (k: string) => {
      const [r, h] = k.split(':').map(Number) as [number, number];
      return m.buttons.some((b) => Math.abs(b.radius - r) <= 1 && Math.abs(b.height - h) <= 2);
    };
    judge('buttons', [...shapes], fits, (off, share) => ({
      kind: 'consistency',
      detail: `${share}% of the buttons are a shape the model uses (${m.buttons
        .map((b) => `${px(b.height)} tall, ${px(b.radius)} corners`)
        .join('; ')}); off it: ${off
        .slice(0, 3)
        .map(([k, n]) => {
          const [r, h] = k.split(':');
          return `${h}px tall with ${r}px corners ×${n} (e.g. "${String(example.get(k)).slice(0, 30)}")`;
        })
        .join(', ')}`,
    }));
  }
  if (m.colors.length)
    judge(
      'colour',
      (f.palette?.colors ?? []).map(([c, n]) => [c.toLowerCase(), n] as [string, number]),
      (c) => m.colors.some((x) => (deltaE(x, c) ?? 99) <= 5),
      (off, share) => ({
        kind: 'palette',
        detail: `${share}% of the colour use is in the model's palette (${m.colors.length} colours); furthest off: ${off
          .slice(0, 3)
          .map(([c, n]) => `${c} ×${n}`)
          .join(', ')}`,
      }),
    );
  if (m.grid)
    judge(
      'spacing',
      (f.spacing ?? []).filter(([v]) => v > 0).map(([v, n]) => [v, n] as [number, number]),
      // The fit's own rule: an 8px grid keeps 4px as its half-step (design-sense.ts).
      (v) => {
        const unit = (m.grid as { unit: number }).unit;
        const step = unit === 8 ? 4 : unit;
        return v <= 2 || Math.abs(v / step - Math.round(v / step)) * step <= 0.5;
      },
      (off, share) => ({
        kind: 'consistency',
        detail: `${share}% of the spacing is on the model's ${m.grid?.unit}px grid; off it: ${off
          .slice(0, 3)
          .map(([v, n]) => `${px(v)} ×${n}`)
          .join(', ')}`,
      }),
    );
  const h1 = f.headings.find((h) => h.level === 1 && h.size);
  if (h1?.size && m.titles.length && !near(m.titles, h1.size, 0.5))
    findings.push({
      severity: 'info',
      kind: 'scale',
      detail: `the page title is ${px(h1.size)}; the model's titles are ${m.titles.map(px).join(', ')}`,
      sel: h1.sel,
    });
  for (const nav of f.navs ?? [])
    if (m.navMax && nav.strip > m.navMax)
      findings.push({
        severity: 'info',
        kind: 'navigation',
        detail: `"${nav.label}" holds ${nav.strip} entries in one strip; the model's longest holds ${m.navMax}`,
        sel: nav.sel,
      });
  const parts = Object.entries(measures).map(([k, v]) => `${k} ${v}%`);
  if (parts.length)
    findings.unshift({
      severity: 'info',
      kind: 'consistency',
      detail: `against the model of ${name}: ${parts.join(', ')} on it`,
    });
  return { findings, measures };
}
