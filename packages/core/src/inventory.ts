/**
 * Conformity: when a design could not be PLACED (a template read without its runtime, a
 * token file, a DESIGN.md), it can still say what it USES — its palette, type sizes, faces and
 * copy. This checks a build against that: every colour on the page should be near a design
 * colour, every size on the scale, every face one the design names, and every piece of design
 * copy should appear somewhere.
 *
 * It is weaker than a placed comparison and the report says so; it is far stronger than
 * nothing, which is what a pixel-only tool gives a design it cannot render.
 */
import type { Inventory, Screen } from '@faithful/spec';
import { deltaE, parseColor, toHex } from './color.js';
import { type Charge, credit, primaryFamily, type ScreenResult, setRescore, type Tally } from './compare.js';
import type { FaithfulConfig } from './config.js';
import type { Finding } from './findings.js';
import { normalizeText, snippet } from './text.js';

/** Collect what a placed screen uses, so a placed design can also be checked for conformity. */
export function inventoryOf(screen: Screen): Inventory {
  const colors = new Set<string>();
  const sizes = new Set<number>();
  const fams = new Set<string>();
  const radii = new Set<number>();
  const texts: string[] = [];
  for (const e of screen.elements) {
    const s = e.style ?? {};
    for (const c of [s.color, s.background, s.borderColor]) {
      const p = parseColor(c);
      if (p && p.a > 0) colors.add(toHex(p));
    }
    if (s.fontSize) sizes.add(s.fontSize);
    const f = primaryFamily(s.fontFamily);
    if (f) fams.add(f);
    if (s.radius) radii.add(s.radius);
    if (e.text) texts.push(e.text);
  }
  return {
    colors: [...colors],
    fontSizes: [...sizes].sort((a, b) => a - b),
    fontFamilies: [...fams],
    radii: [...radii],
    texts,
  };
}

export function checkConformity(inv: Inventory, build: Screen, cfg: FaithfulConfig, screenId = build.id): ScreenResult {
  const T = cfg.tolerances;
  const vp = `${build.viewport.width}x${build.viewport.height}`;
  const findings: Finding[] = [];
  const charges = new Map<Finding, Charge>();
  const push = (f: Omit<Finding, 'screen' | 'viewport'>, charge?: Charge) => {
    const full: Finding = { ...f, screen: screenId, viewport: vp };
    findings.push(full);
    if (charge) charges.set(full, charge);
  };
  const color: Tally = { ok: 0, total: 0 };
  const style: Tally = { ok: 0, total: 0 };
  const text: Tally = { ok: 0, total: 0 };

  // Palette: one finding per off-palette colour, not per element that uses it.
  if (inv.colors.length) {
    const seen = new Map<string, { n: number; el: (typeof build.elements)[number] }>();
    for (const e of build.elements) {
      const s = e.style ?? {};
      for (const c of [s.color, s.background, s.borderColor]) {
        const p = parseColor(c);
        if (!p || p.a === 0) continue;
        const hex = toHex(p);
        color.total++;
        const nearest = Math.min(...inv.colors.map((d) => deltaE(d, hex) ?? Number.POSITIVE_INFINITY));
        if (nearest <= T.colorFail) {
          color.ok++;
          continue;
        }
        const was = seen.get(hex);
        if (was) was.n++;
        else seen.set(hex, { n: 1, el: e });
      }
    }
    for (const [hex, { n, el }] of seen) {
      const f: Omit<Finding, 'screen' | 'viewport'> = {
        kind: 'palette',
        severity: 'warn',
        detail: `${hex} used ${n}× is not a design colour`,
        buildId: el.id,
      };
      if (el.box) f.box = el.box;
      push(f, { key: 'color', amount: n });
    }
  }
  const check = (list: number[], v: number | undefined, tol: number) =>
    v === undefined || list.some((x) => Math.abs(x - v) <= tol);
  if (inv.fontSizes.length) {
    const off = new Map<number, number>();
    for (const e of build.elements) {
      if (!e.text || e.style?.fontSize === undefined) continue;
      style.total++;
      if (check(inv.fontSizes, e.style.fontSize, T.fontSize)) style.ok++;
      else off.set(e.style.fontSize, (off.get(e.style.fontSize) ?? 0) + 1);
    }
    for (const [size, n] of off)
      push(
        {
          kind: 'scale',
          severity: 'warn',
          detail: `${size}px used ${n}×; design sizes are ${inv.fontSizes.join(', ')}`,
        },
        { key: 'style', amount: n },
      );
  }
  if (inv.fontFamilies.length) {
    const want = new Set(inv.fontFamilies.map((f) => primaryFamily(f)));
    const off = new Map<string, number>();
    for (const e of build.elements) {
      const f = primaryFamily(e.style?.fontFamily);
      if (!e.text || !f) continue;
      style.total++;
      if (want.has(f)) style.ok++;
      else off.set(f, (off.get(f) ?? 0) + 1);
    }
    for (const [f, n] of off)
      push(
        { kind: 'font', severity: 'error', detail: `${f} is not one of ${[...want].join(', ')}` },
        { key: 'style', amount: n },
      );
  }
  // Copy: each design string must appear in ONE build element, exactly, as whole words —
  // "Pay" is not found in "Payment history", nor "Log in" in a "Log" and an "in" apart.
  const texts = build.elements.map((e) => normalizeText(e.text ?? '')).filter(Boolean);
  for (const t of inv.texts) {
    const n = normalizeText(t);
    if (n.length < 2) continue;
    text.total++;
    if (texts.some((x) => containsWords(x, n))) text.ok++;
    else
      push(
        { kind: 'copy-missing', severity: 'error', detail: `"${snippet(n, 60)}"`, label: snippet(n, 32) },
        { key: 'text', amount: 1 },
      );
  }

  const ratio = (t: Tally) => (t.total ? t.ok / t.total : 1);
  const scoreOf = (x: { text: Tally; color: Tally; style: Tally }) =>
    Math.round((0.5 * ratio(x.text) + 0.3 * ratio(x.color) + 0.2 * ratio(x.style)) * 1000) / 10;
  const score = scoreOf({ text, color, style });
  const result: ScreenResult = {
    screen: screenId,
    viewport: vp,
    findings,
    stats: {
      designElements: inv.texts.length,
      buildElements: build.elements.length,
      matched: text.ok,
      coverage: ratio(text),
      position: { ok: 0, total: 0 },
      text,
      color,
      style,
    },
    score,
  };
  setRescore(result, (declared) => scoreOf(credit({ text, color, style }, charges, declared).tallies));
  return result;
}

const WORD = /[\p{L}\p{N}]/u;

/** `hay` contains `needle` starting and ending on word boundaries (where the needle has a word character there). */
export function containsWords(hay: string, needle: string): boolean {
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    const before = hay[i - 1];
    const after = hay[i + needle.length];
    const okBefore = !before || !WORD.test(before) || !WORD.test(needle[0] as string);
    const okAfter = !after || !WORD.test(after) || !WORD.test(needle[needle.length - 1] as string);
    if (okBefore && okAfter) return true;
  }
  return false;
}
