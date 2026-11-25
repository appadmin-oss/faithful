/**
 * Compare one design screen with one built screen: pair the elements, then measure every pair
 * against the tolerances in the config, and score the result.
 *
 * Positions are judged RELATIVE TO NEIGHBOURS. One header 20px too tall pushes everything
 * under it down 20px; measured against the page origin that is a hundred findings for one
 * fault, and the agent fixes the wrong hundred. Measured against the nearest matched
 * neighbours it is the one size finding on the header, and the rest pass.
 */
import type { DesignElement, ElementStyle, Screen } from '@usefaithful/spec';
import { contrastRatio, deltaE, isTransparent, parseColor } from './color.js';
import type { FaithfulConfig } from './config.js';
import type { Finding, Kind, Severity } from './findings.js';
import { area, containment, fmtBox, median } from './geometry.js';
import { matchElements, type Pair } from './match.js';
import { motionDiff } from './motion.js';
import { compareCopy, snippet } from './text.js';

export interface Tally {
  ok: number;
  total: number;
}

export interface ScreenStats {
  designElements: number;
  buildElements: number;
  matched: number;
  /** Area-weighted share of the design that found a counterpart. */
  coverage: number;
  position: Tally;
  text: Tally;
  color: Tally;
  style: Tally;
}

export interface ScreenResult {
  screen: string;
  viewport: string;
  findings: Finding[];
  stats: ScreenStats;
  score: number;
}

export const WEIGHTS = { coverage: 0.35, position: 0.25, text: 0.15, color: 0.15, style: 0.1 } as const;

/** What a finding cost the score: which tally it took from, and how much. */
export interface Charge {
  key: 'coverage' | 'position' | 'text' | 'color' | 'style';
  amount: number;
}

/**
 * How to score a screen again once some of its findings are declared deviations. Kept beside
 * the result rather than in it: it is a function of the comparison, not part of the record.
 */
const RESCORE = new WeakMap<ScreenResult, (declared: ReadonlySet<Finding>) => number>();

export function setRescore(r: ScreenResult, f: (declared: ReadonlySet<Finding>) => number): void {
  RESCORE.set(r, f);
}

/**
 * A declared deviation is a decision, not a fault: give back what its finding took from the
 * score, so a run whose every difference is declared is not failed on the percentage.
 */
export function rescoreDeclared(r: ScreenResult, declared: ReadonlySet<Finding>): void {
  const f = RESCORE.get(r);
  if (f && declared.size) r.score = f(declared);
}

/** Tallies with the charges of the declared findings given back. */
export function credit<T extends Record<string, Tally>>(
  tallies: T,
  charges: ReadonlyMap<Finding, Charge>,
  declared: ReadonlySet<Finding>,
): { tallies: T; coverage: number } {
  const out = Object.fromEntries(Object.entries(tallies).map(([k, t]) => [k, { ...t }])) as T;
  let coverage = 0;
  for (const [f, c] of charges) {
    if (!declared.has(f)) continue;
    if (c.key === 'coverage') coverage += c.amount;
    else {
      const t = out[c.key] as Tally | undefined;
      if (t) t.ok = Math.min(t.total, t.ok + c.amount);
    }
  }
  return { tallies: out, coverage };
}

const ratio = (t: Tally): number => (t.total ? t.ok / t.total : 1);

export function scoreOf(s: Omit<ScreenStats, 'designElements' | 'buildElements' | 'matched'>): number {
  const v =
    WEIGHTS.coverage * s.coverage +
    WEIGHTS.position * ratio(s.position) +
    WEIGHTS.text * ratio(s.text) +
    WEIGHTS.color * ratio(s.color) +
    WEIGHTS.style * ratio(s.style);
  return Math.round(v * 1000) / 10;
}

/** First family in a font-family list, unquoted and lower-cased: `"Inter", sans-serif` → `inter`. */
export function primaryFamily(f: string | undefined): string | undefined {
  if (!f) return undefined;
  const first = f
    .split(',')[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, '')
    .toLowerCase();
  return first || undefined;
}

type Placed = {
  d: { box: { x: number; y: number; w: number; h: number } };
  b: { box: { x: number; y: number; w: number; h: number } };
};
/** How far an element's left edge, centre and right edge moved, design → build. */
const edgesX = (p: Placed): number[] => [
  p.b.box.x - p.d.box.x,
  p.b.box.x + p.b.box.w / 2 - (p.d.box.x + p.d.box.w / 2),
  p.b.box.x + p.b.box.w - (p.d.box.x + p.d.box.w),
];

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  '-apple-system',
  'blinkmacsystemfont',
  'emoji',
  'math',
]);

/** Faces an operating system substitutes metric-for-metric: the same layout, another name. */
const METRIC_TWINS: string[][] = [
  ['arial', 'helvetica', 'liberation sans', 'arimo', 'nimbus sans', 'nimbus sans l', 'helvetica neue'],
  ['times new roman', 'times', 'liberation serif', 'tinos', 'nimbus roman', 'nimbus roman no9 l'],
  ['courier new', 'courier', 'liberation mono', 'cousine', 'nimbus mono', 'nimbus mono ps'],
  ['calibri', 'carlito'],
  ['cambria', 'caladea'],
];

/** What may follow a family's name in the name of the face that drew it: weight, style, axes. */
const FACE_SUFFIX =
  /^(?:thin|hairline|extralight|ultralight|light|regular|normal|book|roman|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|oblique|variable|var|vf|\d+)*$/;

/**
 * Was `asked` drawn by `drawn`? The same family with a weight or style suffix ("Inter" drawn
 * as "Inter Bold", "Inter-Regular"), or an operating system's metric twin. Never a shorter
 * name ("Noto Sans" for "Noto Sans JP" is another font, with other glyphs) and never a longer
 * one that is a different family ("Inter Tight" for "Inter").
 */
export function sameFace(asked: string, drawn: string): boolean {
  const sq = (x: string) => x.toLowerCase().replace(/[\s_-]+/g, '');
  const a0 = sq(asked);
  const d0 = sq(drawn);
  if (a0 && d0.startsWith(a0) && FACE_SUFFIX.test(d0.slice(a0.length))) return true;
  const a = asked.toLowerCase();
  const d = drawn.toLowerCase();
  return METRIC_TWINS.some((g) => g.includes(a) && g.includes(d));
}

const within = (a: number, b: number, abs: number, pct = 0, of = 0): boolean =>
  Math.abs(a - b) <= Math.max(abs, pct * of);

export function compareScreens(design: Screen, build: Screen, cfg: FaithfulConfig): ScreenResult {
  const T = cfg.tolerances;
  const vp = `${build.viewport.width}x${build.viewport.height}`;
  const findings: Finding[] = [];
  const charges = new Map<Finding, Charge>();
  const add = (
    kind: Kind,
    severity: Severity,
    detail: string,
    d?: DesignElement,
    b?: DesignElement,
    charge?: Charge,
  ) => {
    const f: Finding = { kind, severity, detail, screen: design.id, viewport: vp };
    if (d) f.id = d.id;
    if (b) f.buildId = b.id;
    const label = d?.text ?? b?.text;
    if (label) f.label = snippet(label, 32);
    const box = b?.box ?? d?.box;
    if (box) f.box = box;
    findings.push(f);
    if (charge) charges.set(f, charge);
  };

  const m = matchElements(design.elements, build.elements, build.viewport);
  const position: Tally = { ok: 0, total: 0 };
  const text: Tally = { ok: 0, total: 0 };
  const color: Tally = { ok: 0, total: 0 };
  const style: Tally = { ok: 0, total: 0 };

  // ---- Coverage ------------------------------------------------------------------------
  const weight = (e: DesignElement) => (e.box ? Math.max(area(e.box), 1) : 400);
  const totalArea = design.elements.reduce((n, e) => n + weight(e), 0);
  const matchedArea =
    m.pairs.reduce((n, p) => n + weight(p.d), 0) +
    m.splits.reduce((n, s) => n + weight(s.d), 0) +
    m.merges.reduce((n, g) => n + g.parts.reduce((k, d) => k + weight(d), 0), 0);
  const coverage = totalArea ? Math.min(1, matchedArea / totalArea) : 1;

  for (const d of m.missing) {
    if (!d.box && !d.text) continue;
    const sev: Severity = d.kind === 'box' ? 'warn' : 'error';
    add('missing', sev, `${d.kind}${d.text ? ` "${snippet(d.text, 40)}"` : ''} at ${fmtBox(d.box)}`, d, undefined, {
      key: 'coverage',
      amount: weight(d),
    });
  }
  for (const b of m.extra)
    add('extra', 'warn', `${b.kind}${b.text ? ` "${snippet(b.text, 40)}"` : ''} at ${fmtBox(b.box)}`, undefined, b);
  for (const s of m.splits)
    add(
      'split',
      'warn',
      `"${snippet(s.d.text ?? '', 40)}" is ${s.parts.length} elements in the build`,
      s.d,
      s.parts[0],
    );
  for (const g of m.merges)
    add('merged', 'warn', `${g.parts.length} design texts are one element in the build`, g.parts[0], g.b);

  // ---- Positions, relative to neighbours ----------------------------------------------
  const placed = m.pairs.filter(
    (p): p is Pair & { d: { box: NonNullable<DesignElement['box']> }; b: { box: NonNullable<DesignElement['box']> } } =>
      !!p.d.box && !!p.b.box,
  );
  const dx = placed.map((p) => p.b.box.x - p.d.box.x);
  const dy = placed.map((p) => p.b.box.y - p.d.box.y);
  // The page offset is how the elements with NOTHING placing them moved — the top of the
  // page. Taken over everything, a cascade that moved most of the page would read as the
  // whole build being shifted.
  const roots = placed
    .map((p, i) => ({ p, i }))
    .filter(
      ({ p, i }) =>
        !placed.some(
          (q, j) =>
            j !== i &&
            (q.d.box.y + q.d.box.h <= p.d.box.y + 2 ||
              (area(q.d.box) > area(p.d.box) && containment(p.d.box, q.d.box) >= 0.95)),
        ),
    );
  const pick = roots.length ? roots.map((r) => r.i) : placed.map((_, i) => i);
  const gx = median(pick.map((i) => dx[i] as number));
  const gy = median(pick.map((i) => dy[i] as number));
  if (placed.length >= 3 && (Math.abs(gx) > T.px * 4 || Math.abs(gy) > T.px * 4)) {
    add('offset', 'info', `the build is shifted ${Math.round(gx)},${Math.round(gy)}px overall`);
  }
  // Where each element SHOULD be, given how the things that place it moved: its container
  // (top-left), the nearest element above it (its bottom edge — flow pushes down from there)
  // and the nearest one to its left on the same row (its right edge). An element passes when
  // it moved the way any of those did. Only an element with nothing placing it is judged
  // against "did not move" or "moved with the whole page".
  const refs = placed.map((p, i) => {
    const xs: number[] = [];
    const ys: number[] = [];
    const D = p.d.box;
    let parent: (typeof placed)[number] | undefined;
    for (const [j, q] of placed.entries()) {
      if (j === i) continue;
      const Q = q.d.box;
      if (area(Q) > area(D) && containment(D, Q) >= 0.95 && (!parent || area(Q) < area(parent.d.box))) parent = q;
    }
    if (parent) {
      xs.push(...edgesX(parent));
      ys.push(parent.b.box.y - parent.d.box.y);
    }
    const others = placed.filter((q, j) => j !== i && q !== parent && containment(q.d.box, D) < 0.95);
    const above = others
      .filter((q) => q.d.box.y + q.d.box.h <= D.y + 2)
      .sort(
        (x, y) =>
          D.y - (x.d.box.y + x.d.box.h) - (D.y - (y.d.box.y + y.d.box.h)) ||
          Math.abs(x.d.box.x - D.x) - Math.abs(y.d.box.x - D.x),
      )
      .slice(0, 2);
    for (const q of above) {
      xs.push(...edgesX(q));
      ys.push(q.b.box.y + q.b.box.h - (q.d.box.y + q.d.box.h));
    }
    // A stack that is centred (or bottom-aligned) in its box moves every member when any one
    // changes height: a heading 26px shorter drops the eyebrow above it by 13px. That is the
    // heading's size finding, not the eyebrow's position. Recognised narrowly — the element
    // directly below kept its gap to this one AND changed height — so a real margin fault,
    // with nothing below resizing, is still reported. The container itself is often an
    // unstyled div the inventory never sees, so this asks the neighbour, not the parent.
    const below = others
      .filter((q) => q.d.box.y >= D.y + D.h - 2 && q.d.box.x < D.x + D.w && q.d.box.x + q.d.box.w > D.x)
      .sort((x, y) => x.d.box.y - y.d.box.y)[0];
    if (below) {
      const gapD = below.d.box.y - (D.y + D.h);
      const gapB = below.b.box.y - (p.b.box.y + p.b.box.h);
      const hd = below.b.box.h - below.d.box.h;
      if (Math.abs(gapB - gapD) <= T.px && Math.abs(hd) > T.px) {
        const base = parent ? parent.b.box.y - parent.d.box.y : gy;
        ys.push(base - hd / 2, base - hd);
      }
    }
    const left = others
      .filter((q) => q.d.box.x + q.d.box.w <= D.x + 2 && q.d.box.y < D.y + D.h && q.d.box.y + q.d.box.h > D.y)
      .sort((x, y) => D.x - (x.d.box.x + x.d.box.w) - (D.x - (y.d.box.x + y.d.box.w)))[0];
    if (left) {
      xs.push(left.b.box.x + left.b.box.w - (left.d.box.x + left.d.box.w));
      ys.push(left.b.box.y - left.d.box.y, left.b.box.y + left.b.box.h / 2 - (left.d.box.y + left.d.box.h / 2));
    }
    if (!xs.length) xs.push(0, gx);
    if (!ys.length) ys.push(0, gy);
    return { xs, ys };
  });
  placed.forEach((p, i) => {
    const { xs, ys } = refs[i] as { xs: number[]; ys: number[] };
    // Left, centre or right edge — whichever the element is aligned by. A wider label that
    // is centred moves its left edge; that is a size finding, not a position one.
    const own = edgesX(p);
    const ex = Math.min(...own.flatMap((o) => xs.map((r) => Math.abs(o - r))));
    const ownY = [p.b.box.y - p.d.box.y, p.b.box.y + p.b.box.h / 2 - (p.d.box.y + p.d.box.h / 2)];
    const ey = Math.min(...ownY.flatMap((o) => ys.map((r) => Math.abs(o - r))));
    const tolX = Math.max(T.px, T.pct * p.d.box.w);
    const tolY = Math.max(T.px, T.pct * p.d.box.h);
    position.total++;
    if (ex <= tolX && ey <= tolY) position.ok++;
    // A nudge of a few pixels is a warning; a real displacement is an error. Small shifts
    // are usually the knock-on of something above changing size, which is reported itself.
    else
      add(
        'position',
        Math.max(ex, ey) > Math.max(4, 2 * T.px) ? 'error' : 'warn',
        `off by ${Math.round(ex)}px × ${Math.round(ey)}px from where its neighbours put it`,
        p.d,
        p.b,
        { key: 'position', amount: 1 },
      );

    // Size
    const isText = !!p.d.text && p.d.kind === 'text';
    // Different words are a different width: that is the copy finding, reported on its own.
    // Only the height is judged then — a line that wraps, or a size that changed, still shows.
    const reworded = isText && !!p.b.text && compareCopy(p.d.text as string, p.b.text) === 'mismatch';
    const wOk = reworded
      ? true
      : isText
        ? within(p.b.box.w, p.d.box.w, T.textWidthPx, T.textWidthPct, p.d.box.w)
        : within(p.b.box.w, p.d.box.w, T.px, T.pct, p.d.box.w);
    const hOk = within(p.b.box.h, p.d.box.h, T.px, T.pct, p.d.box.h);
    style.total++;
    // A control the design drew under the minimum target, built at or above it and only
    // GROWN, is the build fixing the design (WCAG 2.5.8), not departing from it.
    const grewToTarget =
      !!p.b.interactive &&
      Math.min(p.d.box.w, p.d.box.h) < cfg.minTarget &&
      Math.min(p.b.box.w, p.b.box.h) >= cfg.minTarget &&
      p.b.box.w >= p.d.box.w - T.px &&
      p.b.box.h >= p.d.box.h - T.px;
    if (wOk && hOk) style.ok++;
    else if (grewToTarget) {
      style.ok++;
      add(
        'improved',
        'info',
        `target ${Math.round(p.d.box.w)}×${Math.round(p.d.box.h)} → ${Math.round(p.b.box.w)}×${Math.round(p.b.box.h)}: the design is under ${cfg.minTarget}px, the build is not`,
        p.d,
        p.b,
      );
    } else
      add(
        'size',
        'error',
        `${Math.round(p.d.box.w)}×${Math.round(p.d.box.h)} → ${Math.round(p.b.box.w)}×${Math.round(p.b.box.h)}`,
        p.d,
        p.b,
        { key: 'style', amount: 1 },
      );
  });

  // ---- Copy and style, per pair --------------------------------------------------------
  // What a text is drawn ON: the smallest element containing it that paints a background.
  // Used to tell a colour change that FIXES a contrast failure from one that breaks the design.
  const groundIn =
    (els: DesignElement[]) =>
    (e: DesignElement): string => {
      if (!e.box) return '#ffffff';
      let best: DesignElement | undefined;
      for (const o of els) {
        if (o === e || !o.box || !o.style?.background || isTransparent(o.style.background)) continue;
        if (containment(e.box, o.box) < 0.95 || area(o.box) <= area(e.box) * 0.99) continue;
        if (!best?.box || area(o.box) < area(best.box)) best = o;
      }
      return best?.style?.background ?? '#ffffff';
    };
  const groundD = groundIn(design.elements);
  const groundB = groundIn(build.elements);
  for (const p of m.pairs) {
    const better = improvedContrast(p.d, p.b, groundD(p.d), groundB(p.b));
    if (better) {
      add('improved', 'info', better, p.d, p.b);
      color.total++;
      color.ok++;
    }
    if (p.d.text && p.b.text) {
      text.total++;
      const c = compareCopy(p.d.text, p.b.text);
      if (c === 'exact') text.ok++;
      else if (c === 'case') {
        text.ok += 0.5;
        add('case', 'warn', `"${snippet(p.d.text, 40)}" → "${snippet(p.b.text, 40)}"`, p.d, p.b, {
          key: 'text',
          amount: 0.5,
        });
      } else
        add('text', 'error', `"${snippet(p.d.text, 48)}" → "${snippet(p.b.text, 48)}"`, p.d, p.b, {
          key: 'text',
          amount: 1,
        });
    }
    compareStyle(p, T, color, style, add, better ? new Set<Kind>(['color', 'background']) : undefined);
    // Motion, when both sides were read for it (a Figma import says nothing, which is not "still").
    if (design.motionRead && build.motionRead)
      for (const m of motionDiff(p.d.style?.motion, p.b.style?.motion)) add('motion', m.severity, m.detail, p.d, p.b);
  }

  // ---- Touch targets, on everything the build makes interactive -------------------------
  // A target the DESIGN draws just as small is the design's fault, not the build's: it is
  // reported as a note ("the design has this too"), so a faithful build is never failed for
  // being faithful — and the problem is still in front of whoever reads the report.
  const designOf = new Map<DesignElement, DesignElement>();
  for (const p of m.pairs) designOf.set(p.b, p.d);
  const small = (e: DesignElement | undefined) => !!e?.box && Math.min(e.box.w, e.box.h) < cfg.minTarget;
  for (const b of build.elements) {
    if (!b.interactive || !b.box || b.box.w === 0 || b.box.h === 0) continue;
    if (Math.min(b.box.w, b.box.h) < cfg.minTarget) {
      const inherited = small(designOf.get(b));
      add(
        'target',
        inherited ? 'info' : 'error',
        `${Math.round(b.box.w)}×${Math.round(b.box.h)}, under ${cfg.minTarget}px${inherited ? ' (the design has this too)' : ''}`,
        undefined,
        b,
      );
    }
  }

  // ---- Fonts that did not load: declared one face, drawn with another -------------------
  // An operating system's metric-compatible stand-in (Arial drawn as Liberation Sans on Linux)
  // is the same design and is not reported. A web font that failed is an error; a face that is
  // neither installed nor loaded as a web font is a warning — it works on the designer's
  // machine and nowhere else.
  const fellBack = new Set<string>();
  const faces = new Set((build.fontFaces ?? []).map((f) => f.toLowerCase()));
  for (const b of build.elements) {
    const want = primaryFamily(b.style?.fontFamily);
    const drawn = b.style?.renderedFont;
    if (!want || !drawn || GENERIC_FAMILIES.has(want) || fellBack.has(want)) continue;
    if (sameFace(want, drawn)) continue;
    fellBack.add(want);
    // Same rule as targets: a design whose own font did not load either is not the build's fault.
    const dd = designOf.get(b);
    const inherited = !!dd?.style?.renderedFont && !sameFace(want, dd.style.renderedFont);
    const sev = inherited ? 'info' : faces.has(want) ? 'error' : 'warn';
    const tail = inherited ? ' (the design has this too)' : '';
    if (faces.has(want))
      add(
        'font-family',
        sev,
        `asks for ${want} but the browser drew ${drawn}: the web font did not load${tail}`,
        undefined,
        b,
      );
    else
      add(
        'font-family',
        sev,
        `asks for ${want}, which is neither installed nor loaded as a web font; drawn as ${drawn}${tail}`,
        undefined,
        b,
      );
  }

  const stats = {
    designElements: design.elements.length,
    buildElements: build.elements.length,
    matched: m.pairs.length + m.splits.length,
    coverage,
    position,
    text,
    color,
    style,
  };
  const result: ScreenResult = { screen: design.id, viewport: vp, findings, stats, score: scoreOf(stats) };
  setRescore(result, (declared) => {
    const c = credit({ position, text, color, style }, charges, declared);
    return scoreOf({
      ...c.tallies,
      coverage: totalArea ? Math.min(1, (matchedArea + c.coverage) / totalArea) : 1,
    });
  });
  return result;
}

type Add = (
  kind: Kind,
  severity: Severity,
  detail: string,
  d?: DesignElement,
  b?: DesignElement,
  charge?: Charge,
) => void;

function compareStyle(
  p: Pair,
  T: FaithfulConfig['tolerances'],
  color: Tally,
  style: Tally,
  addAll: Add,
  skip?: Set<Kind>,
): void {
  const add: Add = (kind, ...rest) => {
    if (!skip?.has(kind)) addAll(kind, ...rest);
  };
  const ds: ElementStyle = p.d.style ?? {};
  const bs: ElementStyle = p.b.style ?? {};
  const colour = (kind: Kind, a: string | undefined, b: string | undefined) => {
    if (a === undefined || b === undefined) return;
    // "No background" against "no background" is a match; against a fill it is a difference.
    if (kind === 'background' && isTransparent(a) && isTransparent(b)) return;
    const e = deltaE(a, b);
    if (e === null) return;
    color.total++;
    if (e <= T.colorPass) color.ok++;
    else if (e <= T.colorFail) {
      color.ok += 0.5;
      add(kind, 'warn', `${a} → ${b} (ΔE ${e.toFixed(1)})`, p.d, p.b, { key: 'color', amount: 0.5 });
    } else add(kind, 'error', `${a} → ${b} (ΔE ${e.toFixed(1)})`, p.d, p.b, { key: 'color', amount: 1 });
  };
  const metric = (
    kind: Kind,
    a: number | undefined,
    b: number | undefined,
    tol: number,
    sev: Severity,
    unit = 'px',
  ) => {
    if (a === undefined || b === undefined) return;
    style.total++;
    if (Math.abs(a - b) <= tol) style.ok++;
    else add(kind, sev, `${round(a)}${unit} → ${round(b)}${unit}`, p.d, p.b, { key: 'style', amount: 1 });
  };

  if (p.d.text) {
    colour('color', ds.color, bs.color);
    metric('font-size', ds.fontSize, bs.fontSize, T.fontSize, 'error');
    metric('font-weight', ds.fontWeight, bs.fontWeight, 0, 'error', '');
    metric('line-height', ds.lineHeight, bs.lineHeight, T.lineHeight, 'warn');
    metric('letter-spacing', ds.letterSpacing, bs.letterSpacing, T.letterSpacing, 'warn');
    const fa = primaryFamily(ds.fontFamily);
    const fb = primaryFamily(bs.fontFamily);
    if (fa && fb) {
      style.total++;
      if (fa === fb) style.ok++;
      else add('font-family', 'error', `${fa} → ${fb}`, p.d, p.b, { key: 'style', amount: 1 });
    }
  }
  colour('background', ds.background, bs.background);
  if ((ds.borderWidth ?? 0) > 0 || (bs.borderWidth ?? 0) > 0) {
    metric('border', ds.borderWidth ?? 0, bs.borderWidth ?? 0, 0.5, 'error');
    colour('border', ds.borderColor, bs.borderColor);
  }
  metric('radius', ds.radius, bs.radius, T.radius, 'error');
}

const round = (n: number): string => (Math.round(n * 10) / 10).toString();

/**
 * A text colour (or its ground) changed, and the change takes a WCAG 1.4.3 failure in the
 * design to a pass in the build. Only a threshold CROSSED counts — "a bit more contrast" is
 * taste, and taste is what the design decided.
 */
export function improvedContrast(d: DesignElement, b: DesignElement, groundD: string, groundB: string): string | null {
  if (!d.text || !b.text) return null;
  const fd = parseColor(d.style?.color);
  const fb = parseColor(b.style?.color);
  const gd = parseColor(groundD);
  const gb = parseColor(groundB);
  if (!fd || !fb || !gd || !gb) return null;
  const size = b.style?.fontSize ?? d.style?.fontSize ?? 16;
  const bold = (b.style?.fontWeight ?? d.style?.fontWeight ?? 400) >= 700;
  const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
  const cd = contrastRatio(fd, gd);
  const cb = contrastRatio(fb, gb);
  if (cd >= need || cb < need) return null;
  return `contrast ${cd.toFixed(1)}:1 → ${cb.toFixed(1)}:1: the design fails WCAG 1.4.3 (${need}:1), the build passes`;
}
