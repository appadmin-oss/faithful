/**
 * Copy. Two different jobs, kept apart on purpose:
 *   - PAIRING a design text block with a built one uses similarity (Sørensen–Dice on
 *     character bigrams), because a block may have been reworded, split or joined.
 *   - PASSING copy requires an exact match after normalisation. Similarity never passes copy:
 *     "Save draft" and "Save drafts" are 95% alike and one of them is wrong.
 */

const LIGATURES: Record<string, string> = {
  '\ufb00': 'ff',
  '\ufb01': 'fi',
  '\ufb02': 'fl',
  '\ufb03': 'ffi',
  '\ufb04': 'ffl',
  '\ufb05': 'st',
  '\ufb06': 'st',
};

/**
 * NFC, then only the folds a renderer or a design tool introduces on its own: typographic
 * ligatures, full-width ASCII, typographic quotes, dashes and spaces. Whitespace collapsed,
 * trimmed, case kept. Not NFKC: that would also fold "m²" to "m2" and "½" to "1/2", and those
 * are different copy.
 */
export function normalizeText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[\ufb00-\ufb06]/g, (c) => LIGATURES[c] ?? c)
    .replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\u2000-\u200a\u3000]/g, ' ')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[   ​]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice similarity of two strings over character bigrams, case-insensitive. 0–1. */
export function dice(a: string, b: string): number {
  const x = normalizeText(a).toLowerCase();
  const y = normalizeText(b).toLowerCase();
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const bx = bigrams(x);
  const by = bigrams(y);
  let overlap = 0;
  for (const [g, n] of bx) overlap += Math.min(n, by.get(g) ?? 0);
  return (2 * overlap) / (x.length - 1 + (y.length - 1));
}

export type CopyMatch = 'exact' | 'case' | 'mismatch';

/** Compare copy as a reader sees it. `case` = same words, different capitalisation. */
export function compareCopy(design: string, build: string): CopyMatch {
  const a = normalizeText(design);
  const b = normalizeText(build);
  if (a === b) return 'exact';
  if (a.toLowerCase() === b.toLowerCase()) return 'case';
  return 'mismatch';
}

/** Shorten for a report line: an agent needs to recognise the text, not reread it. */
export function snippet(s: string, max = 40): string {
  const t = normalizeText(s);
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
