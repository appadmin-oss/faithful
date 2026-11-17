/**
 * What an agent reads after a check. Its whole design is the token budget: the default is a
 * handful of short lines — verdict, score, the worst findings each with one fix — and a pointer
 * to the full result on disk. A clean run is ONE line. Everything else is pulled on demand
 * (`faithful explain`), never pushed.
 *
 * Measured, not assumed: `test/report.test.ts` holds the compact report of a 40-finding run
 * under a token ceiling, so a "helpful" extra field cannot quietly triple every call.
 */
import type { Provenance } from '@faithful/spec';
import type { ScreenResult } from './compare.js';
import { type Finding, KINDS, sortFindings } from './findings.js';
import { fmtBox } from './geometry.js';

export interface RunResult {
  /** Result-format version, for anything parsing the JSON. */
  v: 1;
  pass: boolean;
  /** Lowest screen score, 0–100: a run is as good as its worst screen. */
  score: number;
  mode: 'placed' | 'conformity';
  provenance: Provenance;
  /** Below 0.5 confidence, or conformity mode: the result is indicative. */
  indicative: boolean;
  counts: { error: number; warn: number; info: number };
  screens: ScreenResult[];
  findings: Finding[];
}

export function summarise(
  screens: ScreenResult[],
  provenance: Provenance,
  mode: RunResult['mode'],
  passScore: number,
): RunResult {
  const findings = sortFindings(screens.flatMap((s) => s.findings));
  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const score = screens.length ? Math.min(...screens.map((s) => s.score)) : 0;
  return {
    v: 1,
    pass: screens.length > 0 && counts.error === 0 && score >= passScore,
    score,
    mode,
    provenance,
    indicative: mode === 'conformity' || provenance.confidence < 0.5,
    counts,
    screens,
    findings,
  };
}

/** Stable short reference for a finding, so `explain F3` means the same thing every time. */
export const ref = (i: number): string => `F${i + 1}`;

function line(f: Finding, i: number): string {
  const sev = f.severity === 'error' ? 'E' : f.severity === 'warn' ? 'W' : 'I';
  const where = f.buildId ?? f.id ?? '';
  const at = f.box ? ` @${fmtBox(f.box)}` : '';
  const label = f.label && !f.detail.includes(f.label) ? ` "${f.label}"` : '';
  return `${ref(i)} ${sev} ${f.kind}${label}: ${f.detail}${where ? ` [${where}]` : ''}${at}`;
}

/**
 * The compact text report. Fix hints are printed once per KIND, not once per finding — ten
 * colour findings need one sentence about tokens, not ten.
 */
export function formatText(r: RunResult, max = 8, resultPath = '.faithful/last.json'): string {
  const verdict = r.pass ? 'PASS' : 'FAIL';
  const c = r.counts;
  const notes = c.info ? ` · ${c.info} note${c.info === 1 ? '' : 's'}` : '';
  // The verdict is decided by errors; the percentage is how much of the design matched. Printed
  // as "FAIL 99/100" the two read as a contradiction, so the counts sit beside the verdict and
  // the similarity is named for what it is.
  const counts = c.error || c.warn ? `${c.error}E ${c.warn}W` : 'clean';
  const head = `faithful ${verdict} ${counts} · ${Math.floor(r.score)}% match${notes} · ${r.mode}${r.indicative ? ' (indicative)' : ''} · ${r.provenance.format}`;
  // Errors and warnings are listed; notes (an overall offset, a fault the design has too) are
  // counted by kind in one line. A passing run with forty inherited notes is still two lines.
  const act = r.findings.filter((f) => f.severity !== 'info');
  const info = r.findings.filter((f) => f.severity === 'info');
  const out = [head];
  if (act.length) {
    const shown = act.slice(0, max);
    out.push(...shown.map((f) => line(f, r.findings.indexOf(f))));
    const kinds = [...new Set(shown.map((f) => f.kind))];
    out.push(`fix: ${kinds.map((k) => `${k} → ${KINDS[k]}`).join(' | ')}`);
    if (act.length > max) out.push(`+${act.length - max} more · faithful explain --all · ${resultPath}`);
  }
  if (info.length) {
    const byKind = new Map<string, number>();
    for (const f of info) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
    out.push(
      `notes: ${[...byKind].map(([k, n]) => `${k} ×${n}`).join(', ')} (overall offset or faults the design has too) · faithful explain --all`,
    );
  }
  if (r.provenance.warnings.length)
    out.push(
      `reader: ${r.provenance.warnings.slice(0, 2).join('; ')}${r.provenance.warnings.length > 2 ? ` (+${r.provenance.warnings.length - 2})` : ''}`,
    );
  return out.join('\n');
}

/** The compact JSON report: the same content as the text, for a caller that parses. */
export function formatCompact(r: RunResult, max = 8) {
  return {
    v: r.v,
    pass: r.pass,
    score: r.score,
    counts: r.counts,
    mode: r.mode,
    indicative: r.indicative,
    top: r.findings
      .filter((f) => f.severity !== 'info')
      .slice(0, max)
      .map((f) => ({
        ref: ref(r.findings.indexOf(f)),
        k: f.kind,
        s: f.severity,
        d: f.detail,
        ...(f.buildId ? { at: f.buildId } : f.id ? { at: f.id } : {}),
        ...(f.box ? { b: [Math.round(f.box.x), Math.round(f.box.y), Math.round(f.box.w), Math.round(f.box.h)] } : {}),
      })),
    more: Math.max(0, r.findings.filter((f) => f.severity !== 'info').length - max),
    notes: r.counts.info,
    fix: Object.fromEntries(
      [
        ...new Set(
          r.findings
            .filter((f) => f.severity !== 'info')
            .slice(0, max)
            .map((f) => f.kind),
        ),
      ].map((k) => [k, KINDS[k]]),
    ),
  };
}

/** Full detail of one finding, or a range, for `faithful explain`. */
export function explain(r: RunResult, which: string | 'all'): string {
  if (which === 'all') return r.findings.map(line).join('\n') || 'no findings';
  const n = Number.parseInt(which.replace(/^F/i, ''), 10) - 1;
  const f = r.findings[n];
  if (!f) return `no finding ${which}; there are ${r.findings.length}`;
  return [
    line(f, n),
    `kind: ${f.kind} — ${KINDS[f.kind]}`,
    f.id ? `design element: ${f.id}` : '',
    f.buildId ? `build element: ${f.buildId}` : '',
    f.screen ? `screen: ${f.screen} at ${f.viewport}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
