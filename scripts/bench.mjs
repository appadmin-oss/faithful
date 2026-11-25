#!/usr/bin/env node
/**
 * Faithful's audit benchmark: hits, misses and false alarms on a labelled set of pages
 * (fixtures/bench/bench.json), through the same `audit()` the CLI and the MCP server run,
 * stress passes and axe-core included.
 *
 *   node scripts/bench.mjs            the table, as the README prints it
 *   node scripts/bench.mjs --json     the numbers
 *
 * A finding at warning or above whose kind the page does not expect is a false alarm; an
 * expected kind with no finding is a miss. Notes (info) are not counted either way: they are
 * advice, and the verdict does not turn on them. Exits 1 when recall is below 100% or
 * precision below the floor, so a rule change that buys recall with noise fails here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'fixtures/bench');
export const PRECISION_FLOOR = 0.9;

/** Run every labelled page and score it. */
export async function runBench() {
  const { audit } = await import(join(ROOT, 'packages/cli/dist/index.js'));
  const { pages } = JSON.parse(readFileSync(join(DIR, 'bench.json'), 'utf8'));
  const rows = [];
  for (const [file, expected] of Object.entries(pages)) {
    const run = await audit({ target: file, cwd: DIR, config: undefined });
    // Text enlarged ALONE at 200% (Android font scale, iOS text size) goes beyond WCAG, which
    // page zoom meets: its warnings are a robustness class of their own, counted and shown
    // apart, never silently dropped and never mixed into precision.
    const robust = (f) => f.detail.startsWith('with text alone at 200%');
    const counted = run.findings.filter((f) => f.severity !== 'info' && !robust(f));
    const robustness = run.findings.filter((f) => f.severity !== 'info' && robust(f)).map((f) => f.detail.slice(0, 90));
    const found = new Set(counted.map((f) => f.kind));
    const hits = expected.filter((k) => found.has(k));
    const misses = expected.filter((k) => !found.has(k));
    const alarms = counted.filter((f) => !expected.includes(f.kind));
    rows.push({
      file,
      expected,
      hits,
      misses,
      alarms: alarms.map((f) => `${f.kind}: ${f.detail.slice(0, 90)}`),
      robustness,
    });
  }
  const tp = rows.reduce((n, r) => n + r.hits.length, 0);
  const fn = rows.reduce((n, r) => n + r.misses.length, 0);
  const fp = rows.reduce((n, r) => n + r.alarms.length, 0);
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  const cleanPages = rows.filter((r) => !r.expected.length);
  const cleanPass = cleanPages.filter((r) => !r.alarms.length).length;
  const robustOnClean = cleanPages.reduce((n, r) => n + r.robustness.length, 0);
  return { rows, tp, fn, fp, precision, recall, cleanPages: cleanPages.length, cleanPass, robustOnClean };
}

export function table(b) {
  const pct = (x) => `${Math.round(x * 1000) / 10}%`;
  const lines = [
    '| Page | Expected | Found | Missed | False alarms | Text alone at 200% |',
    '|---|---|---|---|---|---|',
    ...b.rows.map(
      (r) =>
        `| ${r.file} | ${r.expected.join(', ') || '(nothing)'} | ${r.hits.join(', ') || '—'} | ${r.misses.join(', ') || '—'} | ${r.alarms.length ? r.alarms.map((a) => a.replace(/\|/g, '/')).join('<br>') : '—'} | ${r.robustness.length || '—'} |`,
    ),
    '',
    `**Precision ${pct(b.precision)}** (${b.tp} hits, ${b.fp} false alarms) · **recall ${pct(b.recall)}** (${b.fn} missed) · known-good pages passing clean: ${b.cleanPass} of ${b.cleanPages}. Robustness warnings on known-good pages with text enlarged alone at 200% (beyond WCAG; a long word in a large heading wider than a phone): ${b.robustOnClean}.`,
  ];
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const b = await runBench();
  console.log(process.argv.includes('--json') ? JSON.stringify(b, null, 2) : table(b));
  process.exit(b.recall < 1 || b.precision < PRECISION_FLOOR ? 1 : 0);
}
