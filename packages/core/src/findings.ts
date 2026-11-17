import type { Box } from '@faithful/spec';

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
