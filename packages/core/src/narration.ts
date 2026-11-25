/**
 * Copy that narrates the interface instead of doing its job: a page that opens by explaining
 * itself ("This page shows your recent transactions"), a heading echoed by the sentence under
 * it ("Recent activity" / "Your recent account activity"), a grid of cards each opening "Use
 * this to…", and footers that sign off "Every figure here is derived from the ledger".
 *
 * Writing guidance agrees on the rule and disagrees on nothing: GOV.UK's design system asks for
 * hint text only where it helps and never to restate a label; its content guidance and NN/g's
 * research both say readers skip introductory text and go straight to the content; Microsoft's
 * writing style guide says to cut words that describe the interface ("this page lets you").
 * The catalogues of generated-UI tells (pixelslop, impeccable, MengTo's) all list the pattern;
 * none had a deterministic test for it. These are deterministic: regexes over the first
 * sentence, word overlap with the heading, and repetition across the page.
 *
 * Restraint, measured against GOV.UK service pages as the negative set: one intro is a choice,
 * a pattern is two or more; a hint a field points at (`aria-describedby`), an empty state, text
 * inside `<details>` and legal or regulatory notices are never counted; a sentence carrying a
 * number, a date or a name adds information and is never an echo.
 */

/** "This page shows…", "The dashboard lets you…", "Here you can…", "Use this section to…". */
const SELF_REF =
  /^(?:(?:this|the) (?:page|section|screen|view|dashboard|panel|card|table|tab|report|area|widget|tool|list|chart|module|overview|summary)(?: below| above)? (?:shows|lists|displays|contains|lets you|allows you|helps you|gives you|provides|summari[sz]es|is where|tracks|collects|brings together|presents|highlights|outlines)|here(?:'s| is) where|here,? you(?:'ll| will| can)|below,? you(?:'ll| will| can)|you(?:'ll| will) find (?:below|here)|use this (?:page|section|screen|view|panel|card|tab|tool|area) to|from here,? you can|on this (?:page|screen|tab),? you(?:'ll| will| can)|in this (?:section|page),? (?:you(?:'ll| will| can)|we))\b/i;

/** "Every figure here is derived from the ledger", "All amounts are calculated from…". */
const SIGNOFF =
  /^(?:every|all|each) (?:figure|number|amount|total|value|balance|metric|statistic|price|count|rate)s? (?:(?:here|on this page|shown|above|below|you see) )?(?:is|are) (?:derived|calculated|computed|sourced|pulled|drawn|taken|generated|based|updated|refreshed|reconciled)\b/i;

/** Notices that must say what they say, whatever it reads like. */
const LEGAL =
  /\b(?:FCA|SEC|FDIC|FINRA|PRA|CBN|SEBI|regulated|authori[sz]ed by|registered in|not (?:financial|investment|legal|tax) advice|capital (?:is )?at risk|past performance|©|copyright|terms(?: and| &) conditions|privacy|cookies?)\b/i;

const STOP = new Set(
  'the a an and or of to in on for with your you our we is are be this that these those it its at by from as all any each every here there see view glance quick quickly easily simply overview get'.split(
    ' ',
  ),
);

/** Content words: three letters or more, lower-cased, no stop words, a plural folded. */
export function contentWords(t: string): string[] {
  return (t.toLowerCase().match(/\p{L}{3,}/gu) ?? [])
    .filter((w) => !STOP.has(w))
    .map((w) => w.replace(/(?<=\w{3})s$/, ''));
}

const firstSentence = (t: string) =>
  (
    t
      .replace(/\s+/g, ' ')
      .trim()
      .match(/^.*?[.!?](?:\s|$)/)?.[0] ?? t
  ).trim();
/** It carries a fact: a digit, a currency, a month, or a name mid-sentence. */
const informative = (t: string) =>
  /\d|[$£€₦¥]|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(t) ||
  /\s(?!I\b)[A-Z][a-z]+/.test(t.replace(/^\s*\S+/, ''));

export type Narration = 'self-reference' | 'echo';

/**
 * Why the sentence under a heading only narrates it, or null when it says something. `echo`:
 * the heading's words again, half or more of the sentence's, in a short sentence with no fact.
 */
export function narrates(heading: string, text: string): Narration | null {
  const s = firstSentence(text);
  if (!s || LEGAL.test(s)) return null;
  if (SELF_REF.test(s)) return 'self-reference';
  const hw = [...new Set(contentWords(heading))];
  const words = s.split(/\s+/).length;
  if (hw.length < 2 || words > 25 || informative(s)) return null;
  // Overlap over the union, not the heading: a sentence that repeats the heading AND says more
  // ("Check your answers before sending your application") is not an echo.
  const bw = new Set(contentWords(s));
  const shared = hw.filter((w) => bw.has(w)).length;
  return shared / new Set([...hw, ...bw]).size >= 0.5 ? 'echo' : null;
}

/** A sign-off that vouches for the page instead of telling the reader something. */
export const signsOff = (t: string): boolean => {
  const s = firstSentence(t);
  return SIGNOFF.test(s) && !LEGAL.test(t);
};

export interface Blurb {
  sel: string;
  heading: string;
  text: string;
  /** The grid this sits in, when its heading is a card's: blurbs in one grid are compared. */
  grid?: string;
}

export interface NarrationReport {
  /** Headings whose first sentence below only narrates them. */
  narrated: { sel: string; heading: string; text: string; why: Narration }[];
  /** Headings with a sentence under them at all, the denominator for density. */
  introduced: number;
  /** Grids whose cards all open the same way, or mostly explain themselves. */
  uniformGrids: { grid: string; n: number; sel: string; opening: string }[];
  signoffs: { sel: string; text: string }[];
}

/** Read a page's headings and the sentences under them, its cards, and its sign-offs. */
export function readNarration(blurbs: Blurb[], notes: { sel: string; text: string }[]): NarrationReport {
  const narrated: NarrationReport['narrated'] = [];
  for (const b of blurbs) {
    const why = narrates(b.heading, b.text);
    if (why) narrated.push({ sel: b.sel, heading: b.heading, text: firstSentence(b.text), why });
  }
  const uniformGrids: NarrationReport['uniformGrids'] = [];
  const grids = new Map<string, Blurb[]>();
  for (const b of blurbs) if (b.grid) grids.set(b.grid, [...(grids.get(b.grid) ?? []), b]);
  for (const [grid, cards] of grids) {
    // Cards that carry data are a table drawn as cards, not a pattern.
    const prose = cards.filter((c) => {
      const n = c.text.split(/\s+/).length;
      return n >= 8 && n <= 40 && !/\d|[$£€₦¥]/.test(c.text);
    });
    if (prose.length < 3) continue;
    // The same first word on every card ("Easily…", "Seamlessly…", "Track…"): a template, not
    // a sentence written for each. An article is how English starts, so it never counts.
    const opening = (t: string) => {
      const w = t.toLowerCase().match(/\p{L}+/u)?.[0] ?? '';
      return /^(?:the|an?)$/.test(w) ? '' : w;
    };
    const counts = new Map<string, number>();
    for (const c of prose) counts.set(opening(c.text), (counts.get(opening(c.text)) ?? 0) + 1);
    counts.delete('');
    const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    const selfRef = prose.filter((c) => narrates(c.heading, c.text)).length;
    if (n >= 3 && n >= prose.length * 0.6) uniformGrids.push({ grid, n, sel: (prose[0] as Blurb).sel, opening: top });
    else if (selfRef >= 3 && selfRef >= prose.length * 0.6)
      uniformGrids.push({ grid, n: selfRef, sel: (prose[0] as Blurb).sel, opening: '' });
  }
  const signoffs = notes.filter((x) => signsOff(x.text));
  return { narrated, introduced: blurbs.length, uniformGrids, signoffs };
}
