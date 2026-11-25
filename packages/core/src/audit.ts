/**
 * `faithful audit`: judge a rendered page on its own, with no design to compare against.
 *
 * The page is measured by @usefaithful/browser (`AuditFacts`); every judgement is made here, so
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
import { contrastRatio, deltaE, type Rgba, toHex } from './color.js';
import type { ScreenResult } from './compare.js';
import { fitSpacingGrid, fitTypeScale, hierarchyInversions, nearMissEdges } from './design-sense.js';
import type { Finding, Kind, Severity } from './findings.js';
import { MOVEMENT } from './motion.js';
import { readNarration } from './narration.js';

export type { AuditFacts, AxeFacts, AxeRule } from './audit-facts.js';

export interface AuditOptions {
  /** Minimum target size in CSS px (WCAG 2.2 AA: 24). */
  minTarget?: number;
  /** Tells together at which the page reads as generated (an error). */
  slopError?: number;
  /** Most entries in one strip of a menu before it is reported (config `audit.navMax`, default 7). */
  navMax?: number;
}

/** Words that stand in for a value: printed only when the code meant to fill them failed. */
const UNRENDERED = /^(undefined|null|NaN|\[object Object\]|Invalid Date)$|\{\{\s*[\w.]+\s*\}\}|\$\{[\w.]+\}/;
const LOREM = /\blorem ipsum\b|\bdolor sit amet\b|\bconsectetur adipiscing\b/i;
const DUMMY = /\b(John|Jane) Doe\b|\bfoo@(bar|example)\.|\b(user|test|your)@example\.com\b|\b123 (Main|Fake) St/i;
const PLACEHOLDER_HOSTS =
  /\b(via\.placeholder\.com|placehold\.(co|it)|placekitten\.com|dummyimage\.com|picsum\.photos|fakeimg\.pl|placeimg\.com|i\.pravatar\.cc|randomuser\.me|ui-avatars\.com|api\.dicebear\.com|robohash\.org)\b/i;
/**
 * Words an agent leaves in the interface when it meant to come back: notes to itself, the
 * stand-in company, a fictional phone number. Each is a fault on a page somebody will read.
 */
const AGENT_LEFTOVERS =
  /\b(TODO|FIXME|TBD)\b|\b[Mm]ock(ed)? data\b|\([Rr]eplace (this|with)\b|\b[Rr]eplace (this|me) with\b|\bYour (Company|Brand|Logo|Name Here)\b|\bAcme (Inc|Corp)\b|\b555[-. ]01\d\d\b|\bplaceholder text\b|\bsample (data|content) only\b/;
/** Titles a scaffold ships with, never meant to reach a reader's tab. */
const SCAFFOLD_TITLES =
  /^(React App|Vite \+ React( \+ TS)?|Vite App|Create Next App|Next\.js App|Svelte(Kit)? app|Vue App|Angular App|Document|Untitled|index\.html?)$/i;
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
  const add = (kind: Kind, severity: Severity, detail: string, buildId?: string, label?: string): Finding => {
    const x: Finding = { kind, severity, detail, screen, viewport: vp };
    if (buildId) x.buildId = buildId;
    if (label) x.label = label;
    findings.push(x);
    return x;
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
  layoutFindings(f, add);

  for (const t of f.texts) {
    const s = t.text.trim();
    if (UNRENDERED.test(s))
      add('placeholder', 'error', `an unrendered value is on the page: "${s.slice(0, 40)}"`, t.sel);
    else if (LOREM.test(s)) add('placeholder', 'error', `placeholder text: "${s.slice(0, 40)}"`, t.sel);
    else if (DUMMY.test(s)) add('placeholder', 'warn', `dummy data: "${s.slice(0, 40)}"`, t.sel);
  }
  const leftover = f.texts.find((t) => AGENT_LEFTOVERS.test(t.text) && !UNRENDERED.test(t.text.trim()));
  if (leftover)
    add('placeholder', 'error', `text left for later is on the page: "${leftover.text.slice(0, 50)}"`, leftover.sel);
  if (f.doc?.viewportMeta === false && f.device === 'phone')
    add(
      'readability',
      'error',
      'no <meta name="viewport">: a phone lays this page out 980px wide and shrinks it to fit, so every word is a third of its size',
    );
  if (f.doc) {
    if (!f.doc.title)
      add('placeholder', 'warn', 'the page has no <title>: its tab, bookmark and search result are blank');
    else if (SCAFFOLD_TITLES.test(f.doc.title))
      add('placeholder', 'warn', `the page title is a scaffold's default ("${f.doc.title}")`);
  }
  const dead = f.deadLinks ?? [];
  if (dead.length) {
    const first = dead[0] as NonNullable<AuditFacts['deadLinks']>[number];
    add(
      'dead',
      'warn',
      `${dead.length} link${dead.length === 1 ? '' : 's'} go${dead.length === 1 ? 'es' : ''} nowhere (${first.href ? `href="${first.href}"` : 'empty href'}${first.name ? `: "${first.name}"` : ''})`,
      first.sel,
    );
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
  axeFindings(f, add);
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

  // ── Narration: copy that explains the interface instead of doing its job ──
  /*
   * "This page shows your recent transactions", a heading echoed by the sentence under it,
   * cards that each open "Easily…", footers that sign off "Every figure here is derived from
   * the ledger". One is a choice and is only noted; the pattern is what reads as generated
   * (core/narration.ts has the rules and the evidence).
   */
  const nar = readNarration(f.slop.blurbs ?? [], f.texts);
  if (nar.narrated.length) {
    const ex = nar.narrated[0] as (typeof nar.narrated)[number];
    const n = nar.narrated.length;
    add(
      'wording',
      n >= 2 ? 'warn' : 'info',
      `${n === 1 ? 'a heading is' : `${n} of ${nar.introduced} headings are`} explained by the sentence under ${n === 1 ? 'it' : 'them'}, e.g. "${ex.text.slice(0, 60)}" under "${ex.heading.slice(0, 30)}": cut it, or say what the heading cannot (a figure, a deadline, what to do next)`,
      ex.sel,
    );
  }
  for (const g of nar.uniformGrids)
    add(
      'wording',
      'warn',
      g.opening
        ? `${g.n} cards in one grid open the same way ("${g.opening[0]?.toUpperCase()}${g.opening.slice(1)}…"): write each for what it does, or let the heading stand alone`
        : `${g.n} cards in one grid each explain themselves: let the headings stand alone, or say what each one is for`,
      g.sel,
    );
  if (nar.signoffs.length)
    add(
      'wording',
      nar.signoffs.length >= 2 ? 'warn' : 'info',
      `${nar.signoffs.length === 1 ? 'a note vouches' : `${nar.signoffs.length} notes vouch`} for the page instead of informing ("${nar.signoffs[0]?.text.slice(0, 60)}"): say it once where it matters, if at all`,
      nar.signoffs[0]?.sel,
    );

  // ── Navigation and structure: the menu's LOGIC, which no amount of looking at pixels finds ──
  navLogic(f, o.navMax ?? 7, add);

  // ── Consistency: with no design, the page is its own reference ──
  consistency(f, add);

  // ── Design sense: the page's own system, fitted, and what misses it ──
  designSense(f, add);

  // ── Motion the reader asked to be spared ──
  reducedMotion(f, add);

  // ── Tells ─────────────────────────────────────────────────────────────────────────
  /*
   * Restraint, after MengTo's audit-ai-design-slop: never reject a technique in isolation. A
   * gradient, a glow, a card is somewhere a choice, so a strong tell is only a WARNING when
   * another tell is on the page with it; alone it is a note. What a tell IS is decided in the
   * probe with the same care: a stripe counts only down a row of cards, decoration only when
   * three layers are stacked on one box, a label only when it repeats its heading.
   */
  const s = f.slop;
  const tells: string[] = [];
  let strongTells = 0;
  const strong: { name: string; n: number; sel?: string }[] = [];
  const tell = (name: string, n: number, sel?: string, isStrong = true) => {
    if (!n) return;
    tells.push(name);
    if (isStrong) {
      strongTells++;
      strong.push({ name, n, ...(sel ? { sel } : {}) });
    }
  };
  tell('gradient text', s.gradientText.length, s.gradientText[0]);
  tell('coloured glow shadows', s.glow.length, s.glow[0]);
  tell('emoji used as icons', s.emojiIcons.length, s.emojiIcons[0]?.sel);
  tell('coloured stripe down one side of a box', s.sideStripes.length, s.sideStripes[0]);
  tell('cards nested in cards', s.nestedCards.length, s.nestedCards[0]);
  tell('decoration stacked on one box (gradient, glow, glass, ring)', s.stacked?.length ?? 0, s.stacked?.[0]);
  tell('a label above a heading that repeats it', s.restated?.length ?? 0, s.restated?.[0]);
  if (nar.narrated.length >= 2)
    tell('headings explained by the sentence under them', nar.narrated.length, nar.narrated[0]?.sel);
  if (nar.uniformGrids.length)
    tell('cards that each explain themselves', nar.uniformGrids.length, nar.uniformGrids[0]?.sel);
  if (nar.signoffs.length >= 2) tell('notes that vouch for the page', nar.signoffs.length, nar.signoffs[0]?.sel);
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
  for (const t of strong)
    add(
      'slop',
      tells.length >= 2 ? 'warn' : 'info',
      `${t.name}${t.n > 1 ? ` ×${t.n}` : ''}${tells.length >= 2 ? '' : ': alone, a choice; noted, not counted against the page'}`,
      t.sel,
    );
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
 * axe-core rules Faithful already measures itself, and better for its purpose: they are not
 * reported from axe, so one fault is never two findings. `color-contrast` → Faithful's
 * `contrast` composites alpha, opacity and layered backgrounds as drawn and groups by colour
 * pair; `target-size` → Faithful's `target`, the same WCAG 2.5.8 rule with the spacing
 * exception, sized to the config's `minTarget`.
 */
export const AXE_MEASURED_BY_FAITHFUL: Readonly<Record<string, Kind>> = {
  'color-contrast': 'contrast',
  'target-size': 'target',
};

/**
 * axe-core's verdicts as findings. One finding per failed rule (critical/serious an error,
 * moderate/minor a warning) with how many elements it flagged and the first one; the rule's
 * help page is kept for `faithful explain`. What axe could not decide is never a pass and
 * never a fault: one note, counted by rule. An axe that did not run is an unmeasured warning,
 * never a silently clean page.
 */
function axeFindings(
  f: AuditFacts,
  add: (kind: Kind, severity: Severity, detail: string, buildId?: string) => Finding,
): void {
  const axe = f.axe;
  if (!axe) return;
  if ('error' in axe) {
    add(
      'unmeasured',
      'warn',
      `axe-core did not run (${axe.error.split('\n')[0]?.slice(0, 100)}): the WCAG rules beyond Faithful's own are unmeasured`,
    );
    return;
  }
  const own = (r: { id: string }) => !Object.hasOwn(AXE_MEASURED_BY_FAITHFUL, r.id);
  // The rule id names the fault; the help line only reminds. The long ones run to 118 characters.
  const short = (t: string) => (t.length <= 60 ? t : `${t.slice(0, 59).replace(/\s+\S*$/, '')}…`);
  for (const r of axe.violations.filter(own)) {
    const x = add(
      'a11y',
      r.impact === 'critical' || r.impact === 'serious' ? 'error' : 'warn',
      `${r.id}: ${short(r.help)}${r.n > 1 ? ` (×${r.n})` : ''}`,
      r.sel || undefined,
    );
    if (r.helpUrl) x.help = r.helpUrl.replace(/\?.*$/, '');
  }
  const review = axe.incomplete.filter(own);
  if (review.length) {
    const n = review.reduce((t, r) => t + r.n, 0);
    const MAX = 4;
    add(
      'a11y',
      'info',
      `needs review: axe-core could not decide ${n} element${n === 1 ? '' : 's'} (${review
        .slice(0, MAX)
        .map((r) => `${r.id} ×${r.n}`)
        .join(', ')}${review.length > MAX ? `, +${review.length - MAX} rules` : ''}): check by hand`,
      review[0]?.sel || undefined,
    );
  }
}

/**
 * The page against itself (no design needed): a value used once or twice beside a near-copy
 * the page uses everywhere is a slip, not a decision — a second blue 1.8 ΔE from the brand's,
 * 15px text among 16px, a 6px corner among 8px ones, one button shaped unlike the rest. Only
 * NEAR copies are reported: a genuinely different value (an accent, a display size) is a choice.
 * After Project Wallace's "unique values" drift and Dembrandt's token clustering, made into
 * findings with both values and their counts.
 */
function consistency(f: AuditFacts, add: (k: Kind, s: Severity, d: string, sel?: string) => void): void {
  const p = f.palette;
  if (!p) return;
  const out: string[] = [];
  const near = <T>(xs: [T, number][], close: (a: T, b: T) => number | null, show: (v: T) => string, what: string) => {
    for (const [rare, rn] of xs) {
      if (rn > 2) continue;
      for (const [common, cn] of xs) {
        if (common === rare || cn < Math.max(3, rn * 3)) continue;
        const d = close(rare, common);
        if (d === null) continue;
        out.push(
          `${what} ${show(rare)} (×${rn}) is a near-copy of ${show(common)} (×${cn})${d ? `, ΔE ${d.toFixed(1)}` : ''}`,
        );
        break;
      }
      if (out.length >= 4) return;
    }
  };
  near(
    p.colors,
    (a, b) => {
      const d = deltaE(a, b);
      return d !== null && d > 0.3 && d < 2.5 ? d : null;
    },
    (v) => v,
    'colour',
  );
  near(
    p.sizes,
    (a, b) => (a !== b && Math.abs(a - b) <= 1 ? 0 : null),
    (v) => `${v}px`,
    'text size',
  );
  near(
    p.radii,
    (a, b) => (a !== b && Math.abs(a - b) <= 2 ? 0 : null),
    (v) => `${v}px`,
    'corner radius',
  );
  // Buttons: the corner is the shape. A minority shaped unlike the rest is one design, twice.
  const radii = new Map<number, typeof p.buttons>();
  for (const b of p.buttons) radii.set(b.radius, [...(radii.get(b.radius) ?? []), b]);
  if (p.buttons.length >= 4 && radii.size > 1) {
    const [main, ...others] = [...radii].sort((a, b) => b[1].length - a[1].length);
    const odd = others.flatMap(([, bs]) => bs);
    if (main && main[1].length >= 2 * odd.length) {
      const r = (x: number) => (x === 999 ? 'pill' : `${x}px`);
      out.push(
        `${odd.length} of ${p.buttons.length} buttons are shaped differently (${[...new Set(odd.map((b) => r(b.radius)))].join(', ')} corners, the rest ${r(main[0])}), e.g. "${odd[0]?.text}"`,
      );
    }
  }
  for (const d of out.slice(0, 4)) add('consistency', 'warn', d);
}

/**
 * A reader who set `prefers-reduced-motion: reduce` (vestibular disorders, migraine, focus)
 * gets a page that still MOVES: a transform or position animation, an endless loop, a moving
 * transition. Fades are allowed — opacity and colour are not motion. Emulating the setting is
 * not enough to pass: what the page did not gate keeps running (Edge's DevTools guide on
 * reduced motion), so this reads what actually remains. WCAG 2.3.3; Apple HIG "Reduce Motion".
 */
/**
 * The system the page follows (type scale, spacing grid, columns, heading order), fitted from
 * the page itself (design-sense.ts), and every value that misses it with the value that fits.
 * One note states the system, so an agent adding to the page uses its numbers, not new ones.
 */
function designSense(f: AuditFacts, add: (k: Kind, s: Severity, d: string, sel?: string) => void): void {
  const px = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}px`;
  const said: string[] = [];
  const scale = f.palette ? fitTypeScale(f.palette.sizes) : null;
  if (scale) {
    said.push(`type on a ${scale.ratio} (${scale.name}) scale from ${px(scale.base)}`);
    for (const o of scale.off.slice(0, 3))
      add(
        'type-scale',
        'info',
        `${px(o.size)} text (×${o.n}) is off the ${scale.ratio} (${scale.name}) scale this page sets from ${px(scale.base)}: use ${px(o.below)} or ${px(o.above)}`,
      );
  }
  const grid = f.spacing ? fitSpacingGrid(f.spacing) : null;
  if (grid) {
    said.push(`spacing on a ${grid.unit}px grid (${Math.round(grid.coverage * 100)}% of it)`);
    for (const o of grid.off.slice(0, 3))
      add(
        'consistency',
        'info',
        `${px(o.value)} spacing (×${o.n}) is off the ${grid.unit}px grid this page uses for ${Math.round(grid.coverage * 100)}% of its spacing: use ${px(o.below)} or ${px(o.above)}`,
        o.sel,
      );
  }
  for (const m of nearMissEdges(f.edges ?? []).slice(0, 3))
    add(
      'consistency',
      'warn',
      `starts ${m.by}px ${m.x > m.to ? 'right' : 'left'} of the edge ${m.shared} elements share (x=${m.to}): align it to that edge`,
      m.sel,
    );
  for (const h of hierarchyInversions(f.headings))
    add(
      'heading',
      'warn',
      `h${h.lower} is drawn larger (${px(h.lowerPx)}) than h${h.upper} (${px(h.upperPx)}): the outline a screen reader hears and the order the eye sees disagree`,
      h.sel,
    );
  if (said.length) add('consistency', 'info', `the page's system: ${said.join('; ')}. New elements should use it`);
}

function reducedMotion(f: AuditFacts, add: (k: Kind, s: Severity, d: string, sel?: string) => void): void {
  const list = f.reducedMotion ?? [];
  const moves = (k: string | undefined) => !!k && k.split(',').some((p) => MOVEMENT.test(p.trim()));
  const offenders: { sel: string; what: string }[] = [];
  for (const m of list) {
    const anim = [...m.reading.a, ...m.reading.s].find((a) => moves(a.k) || a.i === 'infinite');
    const trans = m.reading.t.find((t) => MOVEMENT.test(t.p) && t.p !== 'all' && t.d > 0);
    if (anim) offenders.push({ sel: m.sel, what: `${anim.p} ${anim.d}ms${anim.i === 'infinite' ? ', forever' : ''}` });
    else if (trans) offenders.push({ sel: m.sel, what: `${trans.p} transition ${trans.d}ms` });
  }
  if (!offenders.length) return;
  const first = offenders[0] as { sel: string; what: string };
  add(
    'motion',
    'warn',
    `${offenders.length} element${offenders.length === 1 ? '' : 's'} still move${offenders.length === 1 ? 's' : ''} when the reader has asked for less motion (prefers-reduced-motion): ${first.sel} (${first.what})`,
    first.sel,
  );
}

/** A menu entry's name as a reader compares it: case, spacing, badges and counts aside. */
const navName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s+\d+\+?$/, '')
    .replace(/[^\p{L}\p{N}&]+/gu, ' ')
    .trim();

/**
 * Where a menu entry goes, as one string: path and hash route, resolved against the page;
 * query strings kept apart only when they name the screen (`?tab=`, `?page=`, `?view=`).
 * '' for entries that go nowhere comparable (`#`, `javascript:`, mail, the site root).
 */
function navDest(href: string | undefined, base: string): string {
  if (!href || (/^(#|javascript:|mailto:|tel:)/i.test(href.trim()) && !/^#[/!]?\w/.test(href.trim()))) return '';
  try {
    const u = new URL(href, base || 'http://x/');
    if (!/^(https?|file):$/.test(u.protocol)) return '';
    const path = u.pathname.replace(/\/(index\.\w+)?$/, '') || '/';
    const screen = [...u.searchParams].filter(([k]) => /^(tab|page|view|screen|section)$/i.test(k));
    const dest = `${u.host}${path}${screen.length ? `?${screen.map(([k, v]) => `${k}=${v}`).join('&')}` : ''}${u.hash}`;
    return path === '/' && !u.hash && !screen.length ? '' : dest;
  } catch {
    return '';
  }
}

/**
 * The navigation's logic (MAM Academy, Nov 2026: a portal listed Marking and "Grade entry" for
 * one screen; six console screens were titled differently from the entry that opened them; two
 * menu groups had drifted past the site's own six; every console title was an h2). Each of
 * these is invisible in a screenshot and costs the reader the question "are these the same?".
 */
function navLogic(f: AuditFacts, navMax: number, add: (k: Kind, s: Severity, d: string, sel?: string) => void): void {
  const navs = f.navs ?? [];
  const entries = navs.flatMap((n) => n.entries.filter((e) => !e.logo && navName(e.name)));
  // One destination, two names.
  const byDest = new Map<string, { names: Map<string, string>; sel: string }>();
  for (const e of entries) {
    const d = navDest(e.href, f.url);
    if (!d) continue;
    const g = byDest.get(d) ?? { names: new Map<string, string>(), sel: e.sel };
    if (!g.names.has(navName(e.name))) g.names.set(navName(e.name), e.name);
    byDest.set(d, g);
  }
  let twice = 0;
  for (const [, g] of byDest) {
    if (g.names.size < 2 || twice >= 3) continue;
    twice++;
    add(
      'navigation',
      'warn',
      `one screen is in the menu under ${g.names.size} names ("${[...g.names.values()].join('", "')}"): readers think they are different places`,
      g.sel,
    );
  }
  // One name, two destinations, inside one menu.
  for (const n of navs) {
    const byName = new Map<string, Set<string>>();
    for (const e of n.entries) {
      const d = navDest(e.href, f.url);
      if (!d || e.logo || !navName(e.name)) continue;
      byName.set(navName(e.name), (byName.get(navName(e.name)) ?? new Set()).add(d));
    }
    const clash = [...byName].find(([, ds]) => ds.size > 1);
    if (clash)
      add(
        'navigation',
        'warn',
        `"${clash[0]}" goes to ${clash[1].size} different places in one menu: name each for where it goes`,
        n.sel,
      );
  }
  // The entry for this page says one thing, the page's heading another.
  const h1 = f.headings.find((h) => h.level === 1);
  if (h1) {
    const here = navDest(f.url, f.url);
    const current = entries.filter((e) => e.current);
    const mine = current.length ? current : here ? entries.filter((e) => navDest(e.href, f.url) === here) : [];
    const names = [...new Set(mine.map((e) => e.name))];
    const a = navName(h1.text);
    if (names.length === 1 && a) {
      const b = navName(names[0] as string);
      if (b && a !== b && !a.includes(b) && !b.includes(a))
        add(
          'navigation',
          'warn',
          `the menu calls this page "${names[0]}" but its heading says "${h1.text.slice(0, 60)}": use one name`,
          h1.sel,
        );
    }
  }
  // A strip of the menu wider than the site keeps it.
  for (const n of navs)
    if (n.strip > navMax)
      add(
        'navigation',
        'warn',
        `${n.label ? `the "${n.label}" menu` : 'a menu'} lists ${n.strip} entries in one strip (more than ${navMax}): group or move some`,
        n.sel,
      );
  // Structure: a page names itself with one h1; skipped levels lose the outline.
  if (f.headings.length && !h1)
    add(
      'heading',
      'warn',
      `the page has no h1: its title "${f.headings[0]?.text.slice(0, 50)}" is an h${f.headings[0]?.level}`,
      f.headings[0]?.sel,
    );
  for (let i = 1; i < f.headings.length; i++) {
    const prev = f.headings[i - 1]?.level ?? 1;
    const cur = f.headings[i]?.level ?? 1;
    if (cur > prev + 1) {
      add(
        'heading',
        'info',
        `heading levels skip from h${prev} to h${cur} at "${f.headings[i]?.text.slice(0, 40)}"`,
        f.headings[i]?.sel,
      );
      break;
    }
  }
}

/**
 * One finding per fault, not one per viewport: the same clipped label at a phone and a desktop
 * width is one thing to fix. Where the "reads as generated" summary differs between widths,
 * the widest count is kept.
 */
export function mergeViewports(results: ScreenResult[]): void {
  const seen = new Map<string, Finding>();
  // The same text cut off (or drawn over) in several boxes of ONE screen is one fault repeated
  // — a button on every slide of a carousel — said once, ×n.
  for (const r of results) {
    const reps = new Map<string, { f: Finding; n: number }>();
    r.findings = r.findings.filter((f) => {
      if (f.kind !== 'clipped' && f.kind !== 'overlap') return true;
      const k = `${f.kind}|${f.severity}|${f.detail.replace(/\(([^()]*>[^()]*)\)$/, '')}`;
      const had = reps.get(k);
      if (!had) {
        reps.set(k, { f, n: 1 });
        return true;
      }
      had.n++;
      return false;
    });
    for (const { f, n } of reps.values()) if (n > 1) f.detail += ` ×${n}`;
  }
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
      // An axe rule is one fault per page whichever element it meets first at each width.
      const axeRule = f.kind === 'a11y' ? /^[^:]+/.exec(f.detail)?.[0] : undefined;
      // One fault seen by several stress passes (the same overlap at 200% text and at 320px)
      // is one finding that names every pass, not one per pass.
      const cause = Object.values(STRESS_CAUSE).find((c) => f.detail.startsWith(`${c}: `));
      const body = cause ? f.detail.slice(cause.length + 2) : f.detail;
      const detail = body.replace(
        /\d+px wide in a \d+px screen|×\d+ texts|for \d+ texts?|\d+ more|\(\d+ texts\)/g,
        '#',
      );
      const key = axeRule
        ? `a11y|${f.severity}|${axeRule}`
        : `${f.kind}|${f.buildId ?? ''}|${cause ? 'stress' : 'normal'}|${detail}`;
      const first = seen.get(key);
      if (first) {
        if (f.viewport && first.viewport && !first.viewport.includes(f.viewport)) first.viewport += `,${f.viewport}`;
        if (cause) {
          const had = Object.values(STRESS_CAUSE).filter((c) => first.detail.includes(c));
          if (!had.includes(cause)) {
            const prefix = [...had, cause].join(' and ');
            first.detail = `${prefix}: ${body}`;
          }
          if (f.severity === 'error') first.severity = 'error';
        }
        return false;
      }
      seen.set(key, f);
      return true;
    });
  }
}

/**
 * Clipped, overlapping and covered text, judged by what it IS (the probe's `ctx`), never
 * silently dropped:
 *  - a reader-facing fault is an error (a cover a warning); the same button cut off on three
 *    carousel slides is one fault, ×3 (said by mergeViewports, after the stress passes subtract);
 *  - text in a picture of UI is not a layout fault, but a screen reader reads every word of it,
 *    so it is ONE warning to hide the picture from assistive technology (or make it real text);
 *  - a marquee frozen by reduced motion with its words cut off is a note, with the fix;
 *  - content hidden right now is a note to check when it is shown;
 *  - occluded, layered and floating-label cases are by design, and are said in one note so the
 *    reader can see what was set aside and why.
 */
function layoutFindings(f: AuditFacts, add: (k: Kind, s: Severity, d: string, sel?: string) => void): void {
  const edge = (c: AuditFacts['clipped'][number]) => (c.axis === 'y' ? 'bottom' : (c.side ?? 'right'));
  const decorative: { text: string; why?: string; sel: string }[] = [];
  const hidden: { text: string; sel: string }[] = [];
  const marquee: { text: string; sel: string }[] = [];
  const bydesign = { stacked: 0, layered: 0, label: 0 };
  for (const c of f.clipped) {
    if (c.ctx === 'decorative') decorative.push({ text: c.text, sel: c.sel, ...(c.why ? { why: c.why } : {}) });
    else if (c.ctx === 'hidden') hidden.push({ text: c.text, sel: c.sel });
    else if (c.ctx === 'marquee') marquee.push({ text: c.text, sel: c.sel });
    else add('clipped', 'error', `"${c.text}" is cut off by ${c.by}px (${edge(c)} edge of its box)`, c.sel);
  }
  for (const o of f.overlaps) {
    if (o.ctx === 'decorative') decorative.push({ text: o.text, sel: o.a, ...(o.why ? { why: o.why } : {}) });
    else if (o.ctx === 'hidden') hidden.push({ text: o.text, sel: o.a });
    else if (o.ctx === 'stacked' || o.ctx === 'layered') bydesign[o.ctx]++;
    else add('overlap', 'error', `"${o.text}" is drawn over "${o.other}" (${o.b})`, o.a);
  }
  for (const c of f.covered) {
    if (c.ctx === 'layered' || c.ctx === 'label') bydesign[c.ctx]++;
    else if (c.ctx === 'decorative') decorative.push({ text: c.text, sel: c.sel });
    else add('overlap', 'warn', `"${c.text}" is covered by ${c.by}`, c.sel);
  }
  const pics = f.pictures ?? [];
  if (decorative.length || pics.length) {
    const d = decorative[0];
    const ctl = pics.reduce((n, p) => n + p.controls, 0);
    const what = [
      d &&
        `${decorative.length} text${decorative.length === 1 ? '' : 's'} cut off or drawn over each other in it (e.g. "${d.text}"), which a screen reader reads out`,
      ctl && `${ctl} control${ctl === 1 ? '' : 's'} in it that a keyboard tabs into`,
    ].filter(Boolean);
    add(
      'a11y',
      'warn',
      `a picture of UI is exposed as UI (${d?.why ?? pics[0]?.why}): ${what.join('; ')}. If it is a picture, make it inert with aria-hidden="true" (or role="img" and one aria-label); if it is content, lay it out as content`,
      d?.sel ?? pics[0]?.sel,
    );
  }
  if (marquee.length)
    add(
      'clipped',
      'info',
      `a marquee stands still with "${marquee[0]?.text}" cut off at its edge: that is what a reader who asked for less motion sees; under prefers-reduced-motion, show its items as a static list that fits`,
      marquee[0]?.sel,
    );
  if (hidden.length)
    add(
      'clipped',
      'info',
      `${hidden.length} text${hidden.length === 1 ? ' is' : 's are'} cut off or overlapping in content hidden right now (e.g. "${hidden[0]?.text}"): check ${hidden.length === 1 ? 'it' : 'them'} in the state that shows ${hidden.length === 1 ? 'it' : 'them'}`,
      hidden[0]?.sel,
    );
  const why = [
    bydesign.stacked && `${bydesign.stacked} under an opaque card (a stack or deck)`,
    bydesign.layered && `${bydesign.layered} layered within one heading or control`,
    bydesign.label && `${bydesign.label} a field over its own floating label`,
  ].filter(Boolean);
  if (why.length) add('overlap', 'info', `set aside as by design: ${why.join('; ')}`);
}

/** `faithful audit --stress`: what each pass does to the page, as the finding will say it. */
export const STRESS_CAUSE = {
  expand: 'with text 1.3–2× longer, as in translation',
  rtl: 'in right-to-left',
  spacing: 'with WCAG 1.4.12 text spacing',
  zoom: 'with text alone at 200%',
  reflow: 'at 320px wide (WCAG 1.4.10 reflow)',
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
    .map((f) => ({
      ...f,
      // Text enlarged alone, the layout held, is harsher than WCAG 1.4.4 asks (page zoom meets
      // it, and page zoom reflows): a robustness warning, never a conformance failure. Reflow at
      // 320px IS the 1.4.10 test, so it keeps its severity.
      ...(mode === 'zoom' && f.severity === 'error' ? { severity: 'warn' as const } : {}),
      detail: `${STRESS_CAUSE[mode]}: ${f.detail}`,
    }));
  const errors = findings.filter((x) => x.severity === 'error').length;
  const warns = findings.filter((x) => x.severity === 'warn').length;
  return { ...stressed, findings, score: Math.max(0, 100 - errors * 10 - warns * 3) };
}
