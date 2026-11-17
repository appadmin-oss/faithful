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
import type { Finding } from './findings.js';

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
