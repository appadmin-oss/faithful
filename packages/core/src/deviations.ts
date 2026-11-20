/**
 * `faithful.deviations.json`: the changes a team MEANT. Each entry names what it covers, why,
 * who decided and (optionally) until when:
 *
 *   { "deviations": [
 *     { "kind": "renamed", "match": "My orders", "reason": "copy review, Nov 2026", "owner": "design" },
 *     { "kind": "color", "match": "Book now", "reason": "brand refresh", "owner": "brand", "expires": "2027-03-01" }
 *   ] }
 *
 * A finding a deviation covers becomes a note that quotes the reason, so the run passes and the
 * decision stays in front of every reader. An expired entry stops covering anything. An entry
 * that covers nothing is reported, because a ledger nobody prunes turns into a list of excuses.
 *
 * It is a committed file reviewed in the diff, like the guard baseline, and no MCP tool writes
 * it: a verifier the agent can quietly loosen is no verifier.
 */
import { type Finding, KINDS } from './findings.js';

export interface Deviation {
  /** Finding kind it covers (e.g. "renamed", "color", "lost"). Omitted: any kind. */
  kind?: string;
  /**
   * What it covers, case-insensitively: words of the finding's label (the element's text or a
   * control's name, on word boundaries), or its exact design or build element id. Never the
   * detail line: a match on "0" there would cover every measurement in the run.
   */
  match: string;
  reason: string;
  owner: string;
  /** YYYY-MM-DD: the last day it covers anything. */
  expires?: string;
}

/** Shorter than this, a match covers whatever happens to contain it. */
export const MIN_MATCH = 3;
/** A finding with no element is matched on its detail, which needs a kind and a longer phrase. */
export const MIN_DETAIL_MATCH = 8;

const realDate = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
};

export function parseDeviations(json: unknown): Deviation[] {
  const list = (json as { deviations?: unknown })?.deviations;
  if (!Array.isArray(list)) throw new Error('faithful.deviations.json: expected { "deviations": [ … ] }');
  return list.map((d, i) => {
    const at = `faithful.deviations.json: entry ${i + 1}`;
    if (typeof d !== 'object' || d === null || Array.isArray(d))
      throw new Error(`${at} must be an object with "match", "reason" and "owner"`);
    const o = d as Partial<Deviation>;
    for (const k of ['match', 'reason', 'owner'] as const) {
      if (typeof o[k] !== 'string' || !(o[k] as string).trim()) throw new Error(`${at} needs a "${k}"`);
    }
    if ((o.match as string).trim().length < MIN_MATCH)
      throw new Error(`${at}: "match" must be at least ${MIN_MATCH} characters, or it covers whatever contains it`);
    if (o.kind !== undefined && (typeof o.kind !== 'string' || !Object.hasOwn(KINDS, o.kind)))
      throw new Error(`${at}: unknown kind ${JSON.stringify(o.kind)}`);
    if (o.expires !== undefined && (typeof o.expires !== 'string' || !realDate(o.expires)))
      throw new Error(`${at}: "expires" must be a date written YYYY-MM-DD, got ${JSON.stringify(o.expires)}`);
    return o as Deviation;
  });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does this deviation name this finding's element? */
export function covers(d: Deviation, f: Finding): boolean {
  if (d.kind && d.kind !== f.kind) return false;
  const want = d.match.trim().toLowerCase();
  if ([f.id, f.buildId].some((x) => x !== undefined && x.toLowerCase() === want)) return true;
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(want)}($|[^\\p{L}\\p{N}])`, 'u');
  if (f.label) return word.test(f.label.toLowerCase());
  // A finding that names no element (a landmark gone, a script error, an off-palette colour) can
  // only be declared by its detail, and only narrowly: the entry must name the kind and a
  // phrase long enough that it cannot be a stray unit or digit.
  if (f.id === undefined && f.buildId === undefined && d.kind && want.length >= MIN_DETAIL_MATCH)
    return word.test(f.detail.toLowerCase());
  return false;
}

export function applyDeviations(
  findings: Finding[],
  devs: Deviation[],
  today = new Date().toISOString().slice(0, 10),
): Finding[] {
  const used = new Set<Deviation>();
  const out = findings.map((f) => {
    if (f.severity === 'info') return f;
    const all = devs.filter((x) => covers(x, f));
    // An expired entry does not shadow a live one for the same element. An expiry that is not
    // a real date (an entry that skipped parseDeviations) covers nothing rather than forever.
    const live = all.find((x) => x.expires === undefined || (realDate(x.expires) && x.expires >= today));
    for (const x of all) used.add(x);
    if (live)
      return { ...f, severity: 'info' as const, detail: `declared: ${f.detail} — ${live.reason} (${live.owner})` };
    const gone = all[0];
    if (gone) return { ...f, detail: `${f.detail} (a deviation covered this until ${gone.expires})` };
    return f;
  });
  for (const d of devs) {
    if (!used.has(d))
      out.push({
        kind: 'unmeasured',
        severity: 'info',
        detail: `deviation "${d.match}"${d.kind ? ` (${d.kind})` : ''} covers nothing in this run: remove it if it is done`,
      });
  }
  return out;
}
