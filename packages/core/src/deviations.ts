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

import type { ScreenResult } from './compare.js';
import { scoreOf } from './compare.js';
import type { Finding } from './findings.js';
import { area } from './geometry.js';

export interface Deviation {
  /** Finding kind it covers (e.g. "renamed", "color", "lost"). Omitted: any kind. */
  kind?: string;
  /** Matched, case-insensitively, against the finding's label, detail and element ids. */
  match: string;
  reason: string;
  owner: string;
  /** ISO date after which it no longer covers anything. */
  expires?: string;
}

export function parseDeviations(json: unknown): Deviation[] {
  const list = (json as { deviations?: unknown })?.deviations;
  if (!Array.isArray(list)) throw new Error('faithful.deviations.json: expected { "deviations": [ … ] }');
  return list.map((d, i) => {
    const o = d as Partial<Deviation>;
    for (const k of ['match', 'reason', 'owner'] as const) {
      if (typeof o[k] !== 'string' || !(o[k] as string).trim())
        throw new Error(`faithful.deviations.json: entry ${i + 1} needs a "${k}"`);
    }
    return o as Deviation;
  });
}

export function applyDeviations(
  findings: Finding[],
  devs: Deviation[],
  today = new Date().toISOString().slice(0, 10),
): Finding[] {
  const used = new Set<Deviation>();
  const out = findings.map((f) => {
    if (f.severity === 'info') return f;
    const hay = `${f.label ?? ''}\n${f.detail}\n${f.id ?? ''}\n${f.buildId ?? ''}`.toLowerCase();
    const d = devs.find((x) => (!x.kind || x.kind === f.kind) && hay.includes(x.match.toLowerCase()));
    if (!d) return f;
    if (d.expires && d.expires < today) {
      used.add(d);
      return { ...f, detail: `${f.detail} (a deviation covered this until ${d.expires})` };
    }
    used.add(d);
    return { ...f, severity: 'info' as const, detail: `declared: ${f.detail} — ${d.reason} (${d.owner})` };
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

/** Which tally a finding counted against, so a declared one can be credited back. */
const TALLY: Record<string, 'position' | 'text' | 'color' | 'style'> = {
  position: 'position',
  text: 'text',
  case: 'text',
  split: 'text',
  merged: 'text',
  color: 'color',
  background: 'color',
  'font-family': 'style',
  'font-size': 'style',
  'font-weight': 'style',
  size: 'style',
  'line-height': 'style',
  'letter-spacing': 'style',
  border: 'style',
  radius: 'style',
};

/**
 * The score with every DECLARED difference credited back. Without it a build whose every
 * difference had been reviewed and declared still scored what its differences cost — a
 * faithful port of a real handoff, with nothing left to fix, sat at 82% against a pass mark
 * of 90 — so the verdict could never reach PASS and the ledger meant nothing to it.
 *
 * Only findings a deviation covered (`declared: …`) are credited, each back into the tally it
 * was counted against; a missing element's area goes back into coverage. Everything still
 * open keeps costing exactly what it did. The uncredited figure is kept as `measured`.
 */
export function rescore(r: ScreenResult): ScreenResult & { measured: number } {
  const st = r.stats;
  const t = {
    position: { ...st.position },
    text: { ...st.text },
    color: { ...st.color },
    style: { ...st.style },
  };
  let coverage = st.coverage;
  for (const f of r.findings) {
    if (f.severity !== 'info' || !f.detail.startsWith('declared: ')) continue;
    if (f.kind === 'missing') {
      if (f.box && st.designArea) coverage = Math.min(1, coverage + Math.max(area(f.box), 1) / st.designArea);
      continue;
    }
    const k = TALLY[f.kind];
    if (k && t[k].ok < t[k].total) t[k].ok++;
  }
  const score = scoreOf({ ...st, coverage, ...t });
  return { ...r, measured: r.score, score };
}
