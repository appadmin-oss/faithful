/**
 * Pair design elements with built ones.
 *
 * Text pairs by WHAT IT SAYS first and where it is second, because copy is the most stable
 * identity an element has: a heading that moved is still the heading. Everything else pairs by
 * where it is, what kind it is and how big it is. Pairing is a minimum-cost assignment, so
 * one element can never be claimed twice and an early element cannot steal a later one's
 * match. Text that was split across elements or joined into one is recognised rather than
 * reported as one thing missing and two things extra.
 */
import type { DesignElement, Viewport } from '@faithful/spec';
import { assign } from './assign.js';
import { centre, iou } from './geometry.js';
import { dice, normalizeText } from './text.js';

export interface Pair {
  d: DesignElement;
  b: DesignElement;
  /** 0 (identical) to 1. */
  cost: number;
}

export interface MatchResult {
  pairs: Pair[];
  splits: Array<{ d: DesignElement; parts: DesignElement[] }>;
  merges: Array<{ b: DesignElement; parts: DesignElement[] }>;
  missing: DesignElement[];
  extra: DesignElement[];
}

/** Below this similarity two texts are not the same text, however close they sit. */
export const TEXT_MIN_SIMILARITY = 0.5;
/** Above this cost two boxes are not the same box. */
export const BOX_MAX_COST = 0.6;
/** Above this many candidates the O(n³) solver gives way to a greedy pass. */
const SOLVER_LIMIT = 350;
const FORBIDDEN = 1e6;

const hasText = (e: DesignElement): boolean => !!e.text && normalizeText(e.text).length > 0;

function distance(a: DesignElement, b: DesignElement, diag: number): number {
  if (!a.box || !b.box) return 0;
  const p = centre(a.box);
  const q = centre(b.box);
  return Math.min(1, Math.hypot(p.x - q.x, p.y - q.y) / diag);
}

function solve(
  rows: DesignElement[],
  cols: DesignElement[],
  cost: (r: DesignElement, c: DesignElement) => number,
  max: number,
): Array<[number, number, number]> {
  if (!rows.length || !cols.length) return [];
  const m = rows.map((r) =>
    cols.map((c) => {
      const v = cost(r, c);
      return v > max ? FORBIDDEN : v;
    }),
  );
  const out: Array<[number, number, number]> = [];
  if (rows.length * cols.length <= SOLVER_LIMIT * SOLVER_LIMIT) {
    assign(m).forEach((j, i) => {
      const v = j >= 0 ? (m[i]?.[j] ?? FORBIDDEN) : FORBIDDEN;
      if (v < FORBIDDEN) out.push([i, j, v]);
    });
    return out;
  }
  // Greedy fallback for very large pages: cheapest pairs first.
  const all: Array<[number, number, number]> = [];
  for (const [i, row] of m.entries()) {
    for (const [j, v] of row.entries()) if (v < FORBIDDEN) all.push([i, j, v]);
  }
  all.sort((x, y) => x[2] - y[2]);
  const ri = new Set<number>();
  const ci = new Set<number>();
  for (const t of all) {
    if (ri.has(t[0]) || ci.has(t[1])) continue;
    ri.add(t[0]);
    ci.add(t[1]);
    out.push(t);
  }
  return out;
}

function pairUp(
  ds: DesignElement[],
  bs: DesignElement[],
  cost: (r: DesignElement, c: DesignElement) => number,
  max: number,
) {
  const pairs: Pair[] = [];
  const usedD = new Set<number>();
  const usedB = new Set<number>();
  for (const [i, j, v] of solve(ds, bs, cost, max)) {
    pairs.push({ d: ds[i] as DesignElement, b: bs[j] as DesignElement, cost: v });
    usedD.add(i);
    usedB.add(j);
  }
  return { pairs, restD: ds.filter((_, i) => !usedD.has(i)), restB: bs.filter((_, j) => !usedB.has(j)) };
}

/** How far from the whole a part may sit and still be one of its pieces: a wrapped line, a span beside it. */
const NEAR_PX = 64;

/** A part's box touches the whole's box grown by a margin (either side unplaced: no evidence against). */
function near(whole: DesignElement, part: DesignElement): boolean {
  if (!whole.box || !part.box) return true;
  const m = Math.max(NEAR_PX, 2 * whole.box.h);
  const w = whole.box;
  const p = part.box;
  return p.x < w.x + w.w + m && p.x + p.w > w.x - m && p.y < w.y + w.h + m && p.y + p.h > w.y - m;
}

/** Top to bottom, then left to right on one line. */
function readingOrder(a: DesignElement, b: DesignElement): number {
  if (!a.box || !b.box) return 0;
  const line = Math.min(a.box.h, b.box.h) / 2;
  return Math.abs(a.box.y - b.box.y) > line ? a.box.y - b.box.y : a.box.x - b.box.x;
}

/**
 * Find unmatched texts that are made of several unmatched texts on the other side. Each part
 * must sit near the whole and claim its OWN stretch of the whole's text, in reading order: two
 * stray "draft" labels across the page are not "Save draft" split in two.
 */
function composites(wholes: DesignElement[], parts: DesignElement[]) {
  const found: Array<{ whole: DesignElement; parts: DesignElement[] }> = [];
  const taken = new Set<DesignElement>();
  for (const w of wholes) {
    const wt = normalizeText(w.text ?? '').toLowerCase();
    if (wt.length < 4) continue;
    const candidates = parts
      .filter((p) => {
        if (taken.has(p) || !near(w, p)) return false;
        const pt = normalizeText(p.text ?? '').toLowerCase();
        return pt.length >= 2 && pt.length < wt.length && wt.includes(pt);
      })
      .sort(readingOrder);
    const inside: DesignElement[] = [];
    let cursor = 0;
    let covered = 0;
    for (const p of candidates) {
      const pt = normalizeText(p.text ?? '').toLowerCase();
      const at = wt.indexOf(pt, cursor);
      if (at < 0) continue;
      inside.push(p);
      cursor = at + pt.length;
      covered += pt.length;
    }
    if (inside.length >= 2 && covered >= 0.8 * wt.length) {
      for (const p of inside) taken.add(p);
      found.push({ whole: w, parts: inside });
    }
  }
  return found;
}

export function matchElements(design: DesignElement[], build: DesignElement[], viewport: Viewport): MatchResult {
  const diag = Math.hypot(viewport.width, viewport.height) || 1;

  // 1. Text, and controls that carry a label: identity is the words. Identical text first —
  //    among copies of one string (a column of "Edit" buttons) position decides.
  const dT = design.filter(hasText);
  const bT = build.filter(hasText);
  const key = (e: DesignElement) => normalizeText(e.text ?? '').toLowerCase();
  const groups = new Map<string, { d: DesignElement[]; b: DesignElement[] }>();
  for (const d of dT) {
    const g = groups.get(key(d)) ?? { d: [], b: [] };
    g.d.push(d);
    groups.set(key(d), g);
  }
  for (const b of bT) groups.get(key(b))?.b.push(b);
  const pairs: Pair[] = [];
  const pairedD = new Set<DesignElement>();
  const pairedB = new Set<DesignElement>();
  for (const g of groups.values()) {
    if (!g.b.length) continue;
    for (const p of pairUp(g.d, g.b, (d, b) => distance(d, b, diag), 1).pairs) {
      pairs.push(p);
      pairedD.add(p.d);
      pairedB.add(p.b);
    }
  }
  let restD = dT.filter((d) => !pairedD.has(d));
  let restB = bT.filter((b) => !pairedB.has(b));

  // 2. Split and joined text, BEFORE fuzzy pairing — otherwise one half of a split heading
  //    pairs with the whole as a "wrong copy" and the other half reads as extra.
  const splits = composites(restD, restB).map((c) => ({ d: c.whole, parts: c.parts }));
  const splitParts = new Set(splits.flatMap((s) => s.parts));
  const splitWholes = new Set(splits.map((s) => s.d));
  restD = restD.filter((d) => !splitWholes.has(d));
  restB = restB.filter((b) => !splitParts.has(b));
  const merges = composites(restB, restD).map((c) => ({ b: c.whole, parts: c.parts }));
  const mergeParts = new Set(merges.flatMap((m) => m.parts));
  const mergeWholes = new Set(merges.map((m) => m.b));
  restD = restD.filter((d) => !mergeParts.has(d));
  restB = restB.filter((b) => !mergeWholes.has(b));

  // 3. Changed copy: similar words, near enough.
  const textCost = (d: DesignElement, b: DesignElement) => {
    const s = dice(d.text ?? '', b.text ?? '');
    if (s < TEXT_MIN_SIMILARITY) return FORBIDDEN;
    return 1 - s + 0.3 * distance(d, b, diag);
  };
  const t = pairUp(restD, restB, textCost, 1.3);
  pairs.push(...t.pairs);
  const textMissing = t.restD;
  const textExtra = t.restB;

  // 4. Everything without words: by place, kind and size. Unlabelled text leftovers do not
  //    take part — a sentence that changed is a text finding, not a box.
  const dB = design.filter((e) => !hasText(e) && e.box);
  const bB = build.filter((e) => !hasText(e) && e.box);
  const boxCost = (d: DesignElement, b: DesignElement) => {
    if (!d.box || !b.box) return FORBIDDEN;
    const ad = d.box.w * d.box.h;
    const ab = b.box.w * b.box.h;
    const sizeSim = Math.max(ad, ab) > 0 ? Math.min(ad, ab) / Math.max(ad, ab) : 1;
    return (
      0.4 * (1 - iou(d.box, b.box)) +
      0.25 * (d.kind === b.kind ? 0 : 1) +
      0.2 * Math.min(1, distance(d, b, diag) * 4) +
      0.15 * (1 - sizeSim)
    );
  };
  const x = pairUp(dB, bB, boxCost, BOX_MAX_COST);

  return {
    pairs: [...pairs, ...x.pairs],
    splits,
    merges,
    missing: [...textMissing, ...x.restD],
    // Extra boxes are not reported: a build adds wrappers a design never draws. Extra text,
    // images and controls are.
    extra: [...textExtra, ...x.restB.filter((b) => b.kind !== 'box')],
  };
}
