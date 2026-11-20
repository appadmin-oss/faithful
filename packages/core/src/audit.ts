/**
 * `faithful audit`: judge a rendered page on its own, with no design to compare against.
 *
 * The page is measured by @faithful/browser (`AuditFacts`); every judgement is made here, so
 * each threshold is testable without a browser. Two kinds of rule, kept apart on purpose:
 *
 *   faults  something a user cannot get past — text cut off or drawn over text, a page that
 *           scrolls sideways on a phone, a broken image, `undefined` printed where a value
 *           should be. Low false-positive rate; these are errors.
 *   tells   patterns typical of generated UI (gradient text, coloured glow, emoji as icons,
 *           a pill above every headline). Any one of them is a legitimate choice somewhere,
 *           so one tell is a warning and the verdict turns on how many appear TOGETHER —
 *           co-occurrence, which is what tells a generated page from a deliberate one.
 *
 * Sources: WCAG 2.2 (1.4.10 reflow, 1.4.12 text spacing, 2.5.8 target size), Baymard on line
 * length (50–75 characters), Anthropic's frontend-design skill and Impeccable's catalogue for
 * the tells.
 */
import type { AuditFacts } from './audit-facts.js';
import { contrastRatio, type Rgba, toHex } from './color.js';
import type { ScreenResult } from './compare.js';
import type { Finding, Kind, Severity } from './findings.js';

export type { AuditFacts } from './audit-facts.js';

export interface AuditOptions {
  /** Minimum target size in CSS px (WCAG 2.2 AA: 24). */
  minTarget?: number;
  /** Tells together at which the page reads as generated (an error). */
  slopError?: number;
}

/** Words that stand in for a value: printed only when the code meant to fill them failed. */
const UNRENDERED = /^(undefined|null|NaN|\[object Object\]|Invalid Date)$|\{\{\s*[\w.]+\s*\}\}|\$\{[\w.]+\}/;
const LOREM = /\blorem ipsum\b|\bdolor sit amet\b|\bconsectetur adipiscing\b/i;
const DUMMY = /\b(John|Jane) Doe\b|\bfoo@(bar|example)\.|\b(user|test|your)@example\.com\b|\b123 (Main|Fake) St/i;
const PLACEHOLDER_HOSTS =
  /\b(via\.placeholder\.com|placehold\.(co|it)|placekitten\.com|dummyimage\.com|picsum\.photos|fakeimg\.pl|placeimg\.com)\b/i;
/** Copy that could sit on any product's homepage. Counted, never flagged one at a time. */
const GENERIC = [
  /\belevate your\b/i,
  /\bunlock the (full )?(power|potential)\b/i,
  /\bseamless(ly)?\b/i,
  /\bsupercharge\b/i,
  /\brevolutioni[sz]e\b/i,
  /\bnext[- ]level\b/i,
  /\bcutting[- ]edge\b/i,
  /\bgame[- ]chang(er|ing)\b/i,
  /\bunleash\b/i,
  /\bin today'?s fast[- ]paced\b/i,
  /\bempower(s|ing)? (you|your|teams|businesses)\b/i,
  /\beffortless(ly)?\b/i,
  /\btransform (the way|your)\b/i,
];
/** Faces so common in generated UI that they are a tell only alongside others. */
const DEFAULT_FACES = new Set([
  'inter',
  'roboto',
  'arial',
  'helvetica',
  'system-ui',
  '-apple-system',
  'geist',
  'space grotesk',
  'segoe ui',
]);

export function scoreAudit(f: AuditFacts, screen: string, o: AuditOptions = {}): ScreenResult {
  const minTarget = o.minTarget ?? 24;
  const slopError = o.slopError ?? 5;
  const vp = `${f.viewport.width}x${f.viewport.height}`;
  const findings: Finding[] = [];
  const add = (kind: Kind, severity: Severity, detail: string, buildId?: string, label?: string) => {
    const x: Finding = { kind, severity, detail, screen, viewport: vp };
    if (buildId) x.buildId = buildId;
    if (label) x.label = label;
    findings.push(x);
  };
  const phone = f.viewport.width < 600;

  // ── Faults ────────────────────────────────────────────────────────────────────────
  for (const e of (f.runtime?.errors ?? []).slice(0, 3))
    add('runtime', 'error', `script error on load: ${e.slice(0, 140)}`);
  // A broken image is reported as itself; its failed request would be the same fault twice.
  const brokenSrcs = f.brokenImages.map((i) => i.src.replace(/^\.?\//, ''));
  const failed = (f.runtime?.failed ?? []).filter((r) => !brokenSrcs.some((b) => b && r.url.endsWith(b)));
  if (failed.length)
    add(
      'runtime',
      'warn',
      `${failed.length} request${failed.length === 1 ? '' : 's'} failed: ${failed
        .slice(0, 3)
        .map((r) => `${r.status || 'ERR'} ${r.url.slice(0, 80)}`)
        .join(', ')}`,
    );
  for (const i of f.brokenImages) add('broken', 'error', `image did not load: ${i.src}`, i.sel);

  if (f.scrollWidth > f.viewport.width + 1) {
    const culprits = f.overflow
      .slice(0, 3)
      .map((o) => `${o.sel} (to ${o.right}px)`)
      .join(', ');
    add(
      'overflow',
      phone ? 'error' : 'warn',
      `the page scrolls sideways: ${f.scrollWidth}px wide in a ${f.viewport.width}px screen${culprits ? `; first past the edge: ${culprits}` : ''}`,
      f.overflow[0]?.sel,
    );
  }
  for (const c of f.clipped)
    add(
      'clipped',
      'error',
      `"${c.text}" is cut off by ${c.by}px (${c.axis === 'y' ? 'bottom' : (c.side ?? 'right')} edge of its box)`,
      c.sel,
    );
  for (const o of f.overlaps) add('overlap', 'error', `"${o.text}" is drawn over "${o.other}" (${o.b})`, o.a);
  for (const c of f.covered) add('overlap', 'warn', `"${c.text}" is covered by ${c.by}`, c.sel);

  for (const t of f.texts) {
    const s = t.text.trim();
    if (UNRENDERED.test(s))
      add('placeholder', 'error', `an unrendered value is on the page: "${s.slice(0, 40)}"`, t.sel);
    else if (LOREM.test(s)) add('placeholder', 'error', `placeholder text: "${s.slice(0, 40)}"`, t.sel);
    else if (DUMMY.test(s)) add('placeholder', 'warn', `dummy data: "${s.slice(0, 40)}"`, t.sel);
  }
  const placeholderImgs = f.imageSrcs.filter((u) => PLACEHOLDER_HOSTS.test(u));
  if (placeholderImgs.length)
    add(
      'placeholder',
      'warn',
      `${placeholderImgs.length} placeholder image${placeholderImgs.length === 1 ? '' : 's'} (${placeholderImgs[0]?.slice(0, 60)})`,
    );

  if (f.invisible.length) {
    const e = f.invisible[0] as AuditFacts['invisible'][number];
    add(
      'hidden',
      f.invisible.length >= 3 ? 'warn' : 'info',
      `${f.invisible.length} text block${f.invisible.length === 1 ? ' is' : 's are'} invisible (opacity 0) until a script reveals ${f.invisible.length === 1 ? 'it' : 'them'}, e.g. "${e.text}"`,
      e.sel,
    );
  }

  // ── Reading ───────────────────────────────────────────────────────────────────────
  const body = f.paragraphs.filter((p) => p.lines >= 3);
  if (body.length) {
    const cpl = [...body].map((p) => p.cpl).sort((a, b) => a - b);
    const median = cpl[Math.floor(cpl.length / 2)] as number;
    const worst = body.reduce((a, b) => (b.cpl > a.cpl ? b : a));
    if (median > 90) add('readability', 'warn', `body lines run to ${median} characters (50–75 reads best)`, worst.sel);
    const tight = body.filter((p) => p.lineHeight < 1.3);
    if (tight.length)
      add(
        'readability',
        'warn',
        `body line height ${tight[0]?.lineHeight} on ${tight.length} paragraph${tight.length === 1 ? '' : 's'} (about 1.5 reads best)`,
        tight[0]?.sel,
      );
    const small = body.filter((p) => p.fontSize < (phone ? 15 : 13));
    if (small.length)
      add(
        'readability',
        'warn',
        `body text at ${small[0]?.fontSize}px on ${small.length} paragraph${small.length === 1 ? '' : 's'}${phone ? ' on a phone' : ''}`,
        small[0]?.sel,
      );
  }
  contrastFindings(f, add);
  // WCAG 2.5.8: 24×24, unless the target is spaced well clear of every other one.
  for (const t of f.targets.filter((t) => (t.w < minTarget || t.h < minTarget) && !t.spaced).slice(0, 6)) {
    add(
      'target',
      'warn',
      `"${t.text || '(no label)'}" is ${t.w}×${t.h}px; the minimum is ${minTarget}×${minTarget}`,
      t.sel,
    );
  }
  if (f.fontSizes.length > 10)
    add(
      'type-scale',
      'warn',
      `${f.fontSizes.length} different font sizes (${f.fontSizes.join(', ')}px): no type scale is being followed`,
    );

  // ── Wording ───────────────────────────────────────────────────────────────────────
  // WCAG 2.4.4 / 2.4.9: a link must make sense out of context — a screen-reader user often
  // hears a list of links with nothing around them.
  const VAGUE = /^(click here|here|read more|learn more|more|link|this|go|details|continue reading)$/i;
  const seen = f.controls.filter((c) => c.visible !== false);
  const vague = seen.filter((c) => c.role === 'link' && VAGUE.test(c.name.replace(/[.…→›»\s]+$/, '')));
  const vagueTargets = new Set(vague.map((c) => c.href ?? c.sel));
  if (
    vague.length &&
    (vague.some((c) => /^(click here|here|link|this)$/i.test(c.name.trim())) || vagueTargets.size > 1)
  ) {
    add(
      'wording',
      'warn',
      `${vague.length} link${vague.length === 1 ? '' : 's'} named only "${vague[0]?.name}"${vagueTargets.size > 1 ? `, going to ${vagueTargets.size} different places` : ''}: say where each goes`,
      vague[0]?.sel,
    );
  }
  const genericButtons = seen.filter(
    (c) => c.role === 'button' && /^(submit|ok|okay|click|send|go|yes|no)$/i.test(c.name),
  );
  if (genericButtons.length)
    add(
      'wording',
      'warn',
      `button${genericButtons.length === 1 ? '' : 's'} named "${genericButtons.map((c) => c.name).join('", "')}": name what it does, e.g. "Save changes"`,
      genericButtons[0]?.sel,
    );
  // One action, two names on one page: a reader wonders whether they are different things.
  const SYNONYMS: [RegExp, RegExp, string][] = [
    [/\bsign in\b/i, /\blog ?in\b/i, 'Sign in / Log in'],
    [/\bsign out\b/i, /\blog ?out\b/i, 'Sign out / Log out'],
    [/\bsign up\b/i, /\bregister\b/i, 'Sign up / Register'],
    [/\be-mail\b/i, /\bemail\b/i, 'e-mail / email'],
    [/\b(shopping )?cart\b/i, /\bbasket\b/i, 'cart / basket'],
  ];
  const labels = [...seen.map((c) => c.name), ...f.headings.map((h) => h.text)].join('\n');
  for (const [a, b, name] of SYNONYMS)
    if (a.test(labels) && b.test(labels))
      add('wording', 'warn', `the same action has two names on this page (${name}): pick one`);
  // Capitalisation: Title Case and sentence case mixed among headings.
  const words = (t: string) => t.split(/\s+/).filter((w) => /^[A-Za-z]{4,}$/.test(w));
  const title = f.headings.filter(
    (h) =>
      words(h.text).length >= 3 &&
      words(h.text)
        .slice(1)
        .every((w) => /^[A-Z]/.test(w)),
  );
  const sentence = f.headings.filter(
    (h) =>
      words(h.text).length >= 3 &&
      words(h.text)
        .slice(1)
        .filter((w) => /^[a-z]/.test(w)).length >= 2,
  );
  if (title.length && sentence.length)
    add(
      'wording',
      'warn',
      `headings mix Title Case ("${title[0]?.text.slice(0, 40)}") and sentence case ("${sentence[0]?.text.slice(0, 40)}"): pick one`,
      title[0]?.sel,
    );
  for (const t of f.texts) {
    if (UNRENDERED.test(t.text.trim())) continue;
    const d = /\b(\w{2,})\s+\1\b/i.exec(t.text);
    if (d && !/^(that|had|is|bye|no|so|very|ha|la|do|dum|tut|knock|bla|blah|pom)$/i.test(d[1] as string)) {
      add('wording', 'warn', `repeated word "${d[0]}" in "${t.text.slice(0, 50)}"`, t.sel);
      break;
    }
  }
  const shouty = f.texts.filter(
    (t) => /!{2,}/.test(t.text) || (/[A-Z]{4,}(\s+[A-Z]{4,}){2,}/.test(t.text) && t.text === t.text.toUpperCase()),
  );
  if (shouty.length)
    add(
      'wording',
      'info',
      `${shouty.length} shouted line${shouty.length === 1 ? '' : 's'} (capitals or "!!"), e.g. "${shouty[0]?.text.slice(0, 40)}"`,
      shouty[0]?.sel,
    );

  // ── Tells ─────────────────────────────────────────────────────────────────────────
  const s = f.slop;
  const tells: string[] = [];
  let strongTells = 0;
  const tell = (name: string, n: number, sel?: string, strong = true) => {
    if (!n) return;
    tells.push(name);
    if (strong) {
      strongTells++;
      add('slop', 'warn', `${name}${n > 1 ? ` ×${n}` : ''}`, sel);
    }
  };
  tell('gradient text', s.gradientText.length, s.gradientText[0]);
  tell('coloured glow shadows', s.glow.length, s.glow[0]);
  tell('emoji used as icons', s.emojiIcons.length, s.emojiIcons[0]?.sel);
  tell('coloured stripe down one side of a box', s.sideStripes.length, s.sideStripes[0]);
  tell('cards nested in cards', s.nestedCards.length, s.nestedCards[0]);
  if (s.glass.length > 2) tell('frosted-glass panels', s.glass.length, s.glass[0]);
  if (s.badgeAboveH1) tell('a pill badge above the headline', 1, s.badgeAboveH1);
  const generic = f.texts.filter((t) => GENERIC.some((g) => g.test(t.text)));
  if (generic.length >= 2) tell('copy that could describe any product', generic.length, generic[0]?.sel);
  // Weak alone; they count only towards the total.
  if (s.iconTiles >= 3) tell('icon tile above every heading', s.iconTiles, undefined, false);
  if (s.cardGrids >= 1) tell('rows of identical cards', s.cardGrids, undefined, false);
  if (s.accentHues.some((h) => h >= 245 && h <= 290)) tell('purple-to-violet accent', 1, undefined, false);
  if (s.fonts.length && s.fonts.every((x) => DEFAULT_FACES.has(x)))
    tell(`only default faces (${s.fonts.join(', ')})`, 1, undefined, false);
  const centred = f.paragraphs.filter((p) => p.centred).length;
  if (f.paragraphs.length >= 5 && centred / f.paragraphs.length > 0.6)
    tell('almost every paragraph centred', centred, undefined, false);
  // A purple brand set in Inter with a row of cards is a legitimate design: weak tells alone
  // never make the summary. It needs at least one strong tell to be about generated UI at all.
  if (tells.length >= 3 && strongTells >= 1) {
    add(
      'slop',
      tells.length >= slopError ? 'error' : 'warn',
      `reads as generated: ${tells.length} known tells together (${tells.join('; ')})`,
    );
  }

  const errors = findings.filter((x) => x.severity === 'error').length;
  const warns = findings.filter((x) => x.severity === 'warn').length;
  const zero = { ok: 0, total: 0 };
  return {
    screen,
    viewport: vp,
    findings,
    stats: {
      designElements: 0,
      buildElements: f.texts.length,
      matched: 0,
      coverage: 1,
      position: zero,
      text: zero,
      color: zero,
      style: zero,
    },
    score: Math.max(0, 100 - errors * 10 - warns * 3),
  };
}

/** WCAG 1.4.3 "large text": 18pt (24px), or 14pt (18.66px) bold. */
export const isLargeText = (size: number, weight: number): boolean => size >= 24 || (size >= 18.66 && weight >= 700);

/**
 * WCAG 1.4.3, text contrast: 4.5:1, or 3:1 for large text. One finding per distinct text
 * colour, background and size, with how many texts share it — forty grey captions are one
 * thing to fix. Under 3:1 fails at every size, so it is an error; between 3:1 and 4.5:1 a
 * warning. A text with a shadow or a stroke that fails is not judged (the halo may be what
 * makes it readable); it joins the texts that could not be measured, reported as one note.
 */
function contrastFindings(
  f: AuditFacts,
  add: (kind: Kind, severity: Severity, detail: string, buildId?: string, label?: string) => void,
): void {
  const groups = new Map<string, { sel: string; text: string; ratio: number; need: number; n: number; size: number }>();
  let unknown = f.contrastUnknown?.n ?? 0;
  let unknownSel = f.contrastUnknown?.sel;
  const rgba = (c: [number, number, number]): Rgba => ({ r: c[0], g: c[1], b: c[2], a: 1 });
  for (const t of f.textColors ?? []) {
    const need = isLargeText(t.size, t.weight) ? 3 : 4.5;
    const ratio = contrastRatio(rgba(t.fg), rgba(t.bg));
    if (ratio >= need) continue;
    if (t.shadow) {
      unknown++;
      unknownSel ??= t.sel;
      continue;
    }
    const size = Math.round(t.size * 10) / 10;
    const key = `${toHex(rgba(t.fg))} on ${toHex(rgba(t.bg))}|${size}|${need}`;
    const g = groups.get(key);
    if (g) g.n++;
    else groups.set(key, { sel: t.sel, text: t.text, ratio, need, n: 1, size });
  }
  const worst = [...groups].sort((a, b) => a[1].ratio - b[1].ratio);
  const MAX = 6;
  for (const [key, g] of worst.slice(0, MAX)) {
    // Floored, never rounded up: 4.496 must not print as the 4.5 it fails to reach.
    const r = Math.floor(g.ratio * 100) / 100;
    add(
      'contrast',
      g.ratio < 3 ? 'error' : 'warn',
      `"${g.text}" ${key.split('|')[0]} is ${r}:1 at ${g.size}px; needs ${g.need}:1${g.n > 1 ? ` (×${g.n} texts)` : ''}`,
      g.sel,
    );
  }
  if (worst.length > MAX) {
    const rest = worst.slice(MAX);
    add(
      'contrast',
      rest.some(([, g]) => g.ratio < 3) ? 'error' : 'warn',
      `${rest.length} more low-contrast colour pairs (${rest.reduce((n, [, g]) => n + g.n, 0)} texts), e.g. "${rest[0]?.[1].text}"`,
      rest[0]?.[1].sel,
    );
  }
  if (unknown)
    add(
      'contrast',
      'info',
      `contrast not judged for ${unknown} text${unknown === 1 ? '' : 's'} (${f.contrastUnknown?.why && unknownSel === f.contrastUnknown.sel ? f.contrastUnknown.why : 'a shadow or stroke'}): check by eye`,
      unknownSel,
    );
  if (f.lightControls)
    add(
      'contrast',
      'warn',
      `dark theme: ${f.lightControls.n} native form control${f.lightControls.n === 1 ? ' is' : 's are'} drawn light: the page has prefers-color-scheme: dark styles but never sets color-scheme (add \`:root { color-scheme: light dark }\`)`,
      f.lightControls.sel,
    );
}

/**
 * One finding per fault, not one per viewport: the same clipped label at a phone and a desktop
 * width is one thing to fix. Where the "reads as generated" summary differs between widths,
 * the widest count is kept.
 */
export function mergeViewports(results: ScreenResult[]): void {
  const seen = new Map<string, Finding>();
  let summary: { f: Finding; n: number; owner: ScreenResult } | undefined;
  for (const r of results) {
    r.findings = r.findings.filter((f) => {
      const m = /^reads as generated: (\d+)/.exec(f.detail);
      if (f.kind === 'slop' && m) {
        const n = Number(m[1]);
        if (summary && summary.n >= n) return false;
        if (summary) summary.owner.findings = summary.owner.findings.filter((x) => x !== summary?.f);
        summary = { f, n, owner: r };
        return true;
      }
      // Counts that differ by width (how many texts share a colour) do not make a second fault.
      const detail = f.detail.replace(
        /\d+px wide in a \d+px screen|×\d+ texts|for \d+ texts?|\d+ more|\(\d+ texts\)/g,
        '#',
      );
      const key = `${f.kind}|${f.buildId ?? ''}|${detail}`;
      const first = seen.get(key);
      if (first) {
        if (f.viewport && first.viewport && !first.viewport.includes(f.viewport)) first.viewport += `,${f.viewport}`;
        return false;
      }
      seen.set(key, f);
      return true;
    });
  }
}

/** `faithful audit --stress`: what each pass does to the page, as the finding will say it. */
export const STRESS_CAUSE = {
  expand: 'with text 1.3–2× longer, as in translation',
  rtl: 'in right-to-left',
  spacing: 'with WCAG 1.4.12 text spacing',
} as const;
export type StressMode = keyof typeof STRESS_CAUSE;

/** The layout faults a stress pass is for; the rest of the audit is the normal pass's job. */
const STRESS_KINDS: ReadonlySet<Kind> = new Set<Kind>(['clipped', 'overlap', 'overflow']);

/**
 * Keep only what a stress pass ADDS over the normal pass at the same viewport: a layout fault
 * the normal pass already reported for the same element is one fault, not two. A sideways
 * scroll is the page's, so one already reported is not reported again for another culprit.
 * What stays says what caused it.
 */
export function stressDelta(normal: ScreenResult, stressed: ScreenResult, mode: StressMode): ScreenResult {
  const key = (f: Finding) => (f.kind === 'overflow' ? 'overflow' : `${f.kind}|${f.buildId ?? ''}`);
  const known = new Set(normal.findings.map(key));
  const findings = stressed.findings
    .filter((f) => STRESS_KINDS.has(f.kind) && !known.has(key(f)))
    .map((f) => ({ ...f, detail: `${STRESS_CAUSE[mode]}: ${f.detail}` }));
  const errors = findings.filter((x) => x.severity === 'error').length;
  const warns = findings.filter((x) => x.severity === 'warn').length;
  return { ...stressed, findings, score: Math.max(0, 100 - errors * 10 - warns * 3) };
}
