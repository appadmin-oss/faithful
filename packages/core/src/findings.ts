import type { Box } from '@usefaithful/spec';

export type Severity = 'error' | 'warn' | 'info';

/**
 * Every kind of difference, each with one fix sentence. The kinds are the vocabulary an agent
 * acts on; keep them few and stable — a renamed kind breaks every prompt that names it.
 */
export const KINDS = {
  // Root causes first: an element that is missing, says the wrong thing or is the wrong size
  // moves everything after it, so its position findings are usually symptoms of these.
  missing: 'Add this element; the design has it and the build does not.',
  extra: 'Remove this, or confirm it is live data the design shows elsewhere.',
  text: 'Use the design copy exactly.',
  case: 'Match the design capitalisation (in the source text, not with text-transform).',
  split: 'This design text is split across several build elements; it may be wrapped or broken up.',
  merged: 'Several design texts are joined into one build element.',
  'font-family': 'Use the design typeface; check the font actually loaded.',
  'font-size': 'Use the design font size.',
  'font-weight': 'Use the design font weight.',
  size: 'Resize it to the design box. Fix sizes before positions: a wrong size moves its neighbours.',
  'line-height': 'Use the design line height.',
  'letter-spacing': 'Use the design letter spacing.',
  color: 'Use the design text colour (from a token).',
  background: 'Use the design background colour (from a token).',
  border: 'Match the design border colour and width.',
  radius: 'Use the design corner radius.',
  position: 'Move it; the offset is relative to its neighbours, so the layout around it is right.',
  target: 'Make the touch target at least the minimum size (padding, not a bigger icon).',
  offset: 'The whole page is shifted; check the top-level layout (header height, margins).',
  palette: 'This colour is not in the design palette; use the nearest token.',
  scale: 'This size is not on the design type scale.',
  font: 'This typeface is not one the design uses.',
  'copy-missing': 'This design copy does not appear anywhere in the build.',
  pixels: 'This area looks different from the reference image.',
  unmeasured: 'This could not be measured; the comparison is partial.',
  // Audit kinds: judged on the page alone, with no design to compare against.
  runtime: 'Fix the script error or the failed request; part of the page may not have loaded.',
  broken: 'Fix the image source, or remove the element.',
  overflow: 'Stop it pushing past the screen: check fixed widths, 100vw, white-space:nowrap and long unbroken words.',
  clipped: 'Let the box grow with its text (min-height, not height), or wrap it; never hide text that does not fit.',
  overlap: 'Separate them: text drawn over text, or covered by another element, cannot be read.',
  placeholder: 'Replace the placeholder or the unrendered value with real content.',
  hidden: 'Content is invisible until a script reveals it; show it by default and animate only as an enhancement.',
  contrast:
    'Raise text contrast to 4.5:1 (3:1 at 24px+, or bold 18.66px+) in every theme; a dark theme also needs color-scheme set.',
  a11y: 'Fix what the axe-core rule (named first) asks; `faithful explain` links its guidance.',
  readability: 'Keep body text 50–75 characters per line, line height about 1.5, size at least 16px on phones.',
  'type-scale': 'Use fewer font sizes, from one type scale.',
  wording: 'Say what happens or where it goes, one name per action, one capitalisation style, no shouting.',
  slop: 'A pattern typical of generated UI; replace it with a decision specific to this product.',
  lost: 'Put it back: users could do this before and cannot now.',
  changed: 'Check this was meant: it now goes or sends somewhere else.',
  renamed: 'Confirm the new name is the same action; if it is, record it so the next run knows.',
  improved: 'The build departs from the design here and is measurably better; keep it and tell the designer.',
  navigation:
    'One name per destination, the same in the menu and on the page it opens; keep each strip of a menu short.',
  heading: 'Give the page one h1 that names it, and do not skip heading levels.',
} as const;

export type Kind = keyof typeof KINDS;

export interface Finding {
  kind: Kind;
  severity: Severity;
  /** Design element id, when there is one. */
  id?: string;
  /** Build element id (a CSS path), when there is one. */
  buildId?: string;
  /** The design text, shortened, so an agent can recognise the element. */
  label?: string;
  /** One line: what differs, design → build. */
  detail: string;
  /** Where in the build (or the design, when missing). */
  box?: Box;
  screen?: string;
  viewport?: string;
  /** Where to read more (an axe-core rule's page): shown by `faithful explain`, never in the compact report. */
  help?: string;
}

const ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
const KIND_ORDER = Object.keys(KINDS) as Kind[];

/** Errors first, then by kind order (missing before cosmetic), then top-to-bottom. */
export function sortFindings(fs: Finding[]): Finding[] {
  return [...fs].sort(
    (a, b) =>
      ORDER[a.severity] - ORDER[b.severity] ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      (a.box?.y ?? 0) - (b.box?.y ?? 0) ||
      (a.box?.x ?? 0) - (b.box?.x ?? 0),
  );
}
