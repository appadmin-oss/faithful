/**
 * The programmatic API: everything the CLI and the MCP server do, as functions. Both are thin
 * shells over this, so an agent gets the same answer whichever door it uses.
 */
import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { ADAPTERS } from '@faithful/adapters';
import { Renderer } from '@faithful/browser';
import {
  type Adapter,
  applyDeviations,
  checkConformity,
  compareParity,
  compareScreens,
  countViolations,
  DEFAULT_CONFIG,
  type FaithfulConfig,
  inventoryOf,
  langOf,
  mergeViewports,
  normHref,
  parseDeviations,
  pickAdapter,
  type ReadContext,
  type RunResult,
  ratchet,
  resolveConfig,
  type ScreenResult,
  type SourceInput,
  scanFile,
  scoreAudit,
  selfCheck,
  summarise,
  type Violation,
} from '@faithful/core';
import type { FaithfulSpec, Inventory, Viewport } from '@faithful/spec';

export const OUT_DIR = '.faithful';
export const BASELINE = 'faithful.baseline.json';
export const DEVIATIONS = 'faithful.deviations.json';

export class FaithfulError extends Error {
  override readonly name = 'FaithfulError';
}

/** Read `faithful.config.json` from `cwd` (or defaults). */
export async function loadConfig(cwd = process.cwd(), file?: string): Promise<FaithfulConfig> {
  const path = resolve(cwd, file ?? 'faithful.config.json');
  if (!existsSync(path)) {
    if (file) throw new FaithfulError(`config not found: ${file}`);
    return structuredClone(DEFAULT_CONFIG);
  }
  return resolveConfig(JSON.parse(await readFile(path, 'utf8')));
}

export const isUrl = (s: string): boolean => /^https?:\/\//i.test(s);

/** Parse `1440x900,390x844` (or a single width) into viewports. */
export function parseViewports(s: string | undefined, fallback: Viewport[]): Viewport[] {
  if (!s) return fallback;
  return s.split(',').map((p) => {
    const m = /^(\d+)(?:x(\d+))?$/.exec(p.trim());
    if (!m) throw new FaithfulError(`bad viewport "${p}": use WIDTHxHEIGHT, e.g. 1440x900`);
    const width = Number(m[1]);
    return { width, height: m[2] ? Number(m[2]) : width < 600 ? 844 : 900 };
  });
}

/** One browser for the whole run, launched only if something needs it. */
export class Session {
  private renderer: Promise<Renderer> | null = null;
  readonly warnings: string[] = [];
  constructor(readonly config: FaithfulConfig) {}

  browser(): Promise<Renderer> {
    this.renderer ??= Renderer.launch();
    return this.renderer;
  }

  context(viewports: Viewport[]): ReadContext {
    return {
      viewports,
      render: async (target, vp, id) => (await this.browser()).capture(target, vp, id, { ignore: this.config.ignore }),
      readFile: (p) => readFile(p, 'utf8'),
      exists: async (p) => existsSync(p),
      warn: (m) => this.warnings.push(m),
    };
  }

  async close(): Promise<void> {
    if (this.renderer) await (await this.renderer).close().catch(() => undefined);
  }
}

async function input(path: string): Promise<SourceInput> {
  if (isUrl(path)) return { path, isUrl: true, head: '' };
  if (!existsSync(path)) throw new FaithfulError(`not found: ${path}`);
  const st = await stat(path);
  if (st.isDirectory())
    throw new FaithfulError(`${path} is a folder: name a design file inside it (try \`faithful outline ${path}\`)`);
  const buf = await readFile(path);
  return { path, isUrl: false, head: buf.subarray(0, 65536).toString('utf8') };
}

/** Which reader takes this source, without reading it. */
export async function sniff(path: string, adapters: Adapter[] = ADAPTERS) {
  const pick = pickAdapter(adapters, await input(path));
  if (!pick)
    throw new FaithfulError(`no reader understands ${path}. Formats: ${adapters.map((a) => a.name).join(', ')}`);
  return pick;
}

/** Read a design (any supported format) into a Faithful spec. */
export async function readDesign(
  path: string,
  session: Session,
  viewports: Viewport[],
  adapters: Adapter[] = ADAPTERS,
): Promise<FaithfulSpec> {
  const src = await input(path);
  const pick = pickAdapter(adapters, src);
  if (!pick)
    throw new FaithfulError(`no reader understands ${path}. Formats: ${adapters.map((a) => a.name).join(', ')}`);
  return pick.adapter.read(src, session.context(viewports));
}

export interface VerifyOptions {
  design: string;
  build: string;
  viewports?: string;
  /** Extra conformity sources: a copy deck, a token file, a DESIGN.md. */
  also?: string[];
  config?: FaithfulConfig;
  cwd?: string;
}

/**
 * Compare a build with a design. Placed comparison per design screen at its own viewport;
 * when the design could not be placed (tokens, a copy deck, a DESIGN.md), conformity instead.
 * Extra sources add conformity checks to a placed run.
 */
export async function verify(o: VerifyOptions): Promise<RunResult> {
  const cfg = o.config ?? (await loadConfig(o.cwd));
  const session = new Session(cfg);
  try {
    const vps = parseViewports(o.viewports, cfg.viewports);
    const design = await readDesign(o.design, session, vps);
    const extra: Inventory[] = [];
    for (const a of o.also ?? []) {
      const s = await readDesign(a, session, vps);
      if (s.inventory) extra.push(s.inventory);
      for (const sc of s.screens) extra.push(inventoryOf(sc));
      design.provenance.warnings.push(...s.provenance.warnings.map((w) => `${a}: ${w}`));
    }
    const ctx = session.context(vps);
    const buildTarget = isUrl(o.build)
      ? { url: o.build }
      : { html: await readFile(o.build, 'utf8'), baseDir: resolve(o.build, '..') };
    const results: ScreenResult[] = [];
    const placed = design.screens.filter((s) => s.elements.length > 0);
    if (placed.length) {
      for (const ds of placed) {
        const bs = await ctx.render(buildTarget, ds.viewport, `build@${ds.viewport.width}`);
        const r = compareScreens(ds, bs, cfg);
        for (const inv of extra) {
          const c = checkConformity(inv, bs, cfg, ds.id);
          r.findings.push(...c.findings);
        }
        results.push(r);
      }
    } else {
      const inv = [design.inventory, ...extra].filter((x): x is Inventory => !!x);
      if (!inv.length)
        throw new FaithfulError(
          `${o.design} gave nothing to compare: no screens and no inventory (${design.provenance.warnings.join('; ') || 'no reason given'})`,
        );
      const merged = inv.reduce((a, b) => ({
        colors: [...new Set([...a.colors, ...b.colors])],
        fontSizes: [...new Set([...a.fontSizes, ...b.fontSizes])],
        fontFamilies: [...new Set([...a.fontFamilies, ...b.fontFamilies])],
        radii: [...new Set([...a.radii, ...b.radii])],
        texts: [...new Set([...a.texts, ...b.texts])],
      }));
      for (const vp of vps) {
        const bs = await ctx.render(buildTarget, vp, `build@${vp.width}`);
        results.push(checkConformity(merged, bs, cfg, `conformity@${vp.width}`));
      }
    }
    await withDeviations(results, o.cwd);
    const run = summarise(results, design.provenance, placed.length ? 'placed' : 'conformity', cfg.passScore);
    await save(run, o.cwd);
    return run;
  } finally {
    await session.close();
  }
}

/** Keep the full result on disk; the compact report points here. */
export async function save(run: RunResult, cwd = process.cwd()): Promise<string> {
  const dir = resolve(cwd, OUT_DIR);
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'last.json');
  await writeFile(path, JSON.stringify(run, null, 1));
  return path;
}

export async function lastRun(cwd = process.cwd()): Promise<RunResult> {
  const path = resolve(cwd, OUT_DIR, 'last.json');
  if (!existsSync(path)) throw new FaithfulError('no previous run: run `faithful verify` first');
  return JSON.parse(await readFile(path, 'utf8')) as RunResult;
}

/** A compact outline of a design: what an agent needs before it builds, in few tokens. */
export function outline(s: FaithfulSpec, maxTexts = 24): string {
  const p = s.provenance;
  const lines = [`${p.format} via ${p.adapter} · ${p.tier} · confidence ${p.confidence}`];
  for (const sc of s.screens) {
    const kinds: Record<string, number> = {};
    for (const e of sc.elements) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    lines.push(
      `screen ${sc.id} ${sc.viewport.width}x${sc.viewport.height}${sc.pageHeight ? ` (page ${sc.pageHeight}px)` : ''}: ${
        Object.entries(kinds)
          .map(([k, n]) => `${n} ${k}`)
          .join(', ') || 'no elements'
      }`,
    );
    const inv = inventoryOf(sc);
    if (inv.fontFamilies.length)
      lines.push(`  type: ${inv.fontFamilies.join(', ')} · sizes ${inv.fontSizes.join('/')}`);
    if (inv.colors.length)
      lines.push(
        `  palette (${inv.colors.length}): ${inv.colors.slice(0, 12).join(' ')}${inv.colors.length > 12 ? ' …' : ''}`,
      );
    const texts = sc.elements.filter((e) => e.kind === 'text' && e.text).map((e) => e.text as string);
    if (texts.length)
      lines.push(
        `  copy (${texts.length}): ${texts
          .slice(0, maxTexts)
          .map((t) => JSON.stringify(t.length > 48 ? `${t.slice(0, 47)}…` : t))
          .join(' · ')}${texts.length > maxTexts ? ' …' : ''}`,
      );
  }
  if (s.inventory) {
    const i = s.inventory;
    lines.push(
      `inventory: ${i.colors.length} colours, ${i.fontSizes.length} sizes, ${i.fontFamilies.length} faces, ${i.radii.length} radii, ${i.texts.length} strings`,
    );
  }
  if (s.tokens?.length) lines.push(`tokens: ${s.tokens.length}`);
  if (p.warnings.length) lines.push(`reader: ${p.warnings.join('; ')}`);
  return lines.join('\n');
}

/** An outline of a whole handoff folder: which files are designs, and in what format. */
export async function outlineFolder(dir: string, adapters: Adapter[] = ADAPTERS): Promise<string> {
  const out: string[] = [];
  const walk = async (d: string, depth: number): Promise<void> => {
    if (depth > 5) return;
    for (const name of (await readdir(d)).sort()) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const p = join(d, name);
      const st = await stat(p);
      if (st.isDirectory()) await walk(p, depth + 1);
      else if (st.size < 20_000_000) {
        const pick = pickAdapter(adapters, await input(p));
        if (pick && pick.sniff.confidence >= 0.5) out.push(`${pick.sniff.format.padEnd(24)} ${relative(dir, p)}`);
      }
    }
  };
  await walk(dir, 0);
  return out.length ? out.join('\n') : 'no design sources found';
}

// ── Guards ──────────────────────────────────────────────────────────────────

export interface GuardResult {
  violations: Violation[];
  regressions: ReturnType<typeof ratchet>['regressions'];
  improved: ReturnType<typeof ratchet>['improved'];
  files: number;
  baseline: boolean;
}

async function listFiles(root: string, cfg: FaithfulConfig, only?: string[]): Promise<string[]> {
  if (only?.length) return only.map((f) => relative(root, resolve(root, f)));
  const out: string[] = [];
  const skip = new Set(cfg.guards.exclude);
  const walk = async (d: string): Promise<void> => {
    let entries: string[] = [];
    try {
      entries = await readdir(resolve(root, d));
    } catch {
      return;
    }
    for (const name of entries) {
      if (skip.has(name) || name.startsWith('.')) continue;
      const rel = d ? join(d, name) : name;
      const st = await stat(resolve(root, rel));
      if (st.isDirectory()) await walk(rel);
      else if (langOf(rel) !== 'other' && st.size < 2_000_000 && !/\.min\.(js|css)$/.test(rel)) out.push(rel);
    }
  };
  const roots = cfg.guards.include.filter((i) => existsSync(resolve(root, i)));
  for (const r of roots.length ? roots : ['']) await walk(r);
  return out;
}

export async function guard(
  opts: { cwd?: string; files?: string[]; updateBaseline?: boolean; config?: FaithfulConfig } = {},
): Promise<GuardResult> {
  const cwd = opts.cwd ?? process.cwd();
  const cfg = opts.config ?? (await loadConfig(cwd));
  const files = await listFiles(cwd, cfg, opts.files);
  const violations: Violation[] = [];
  for (const f of files) {
    let text = '';
    try {
      text = await readFile(resolve(cwd, f), 'utf8');
    } catch {
      continue;
    }
    violations.push(...scanFile(f.split('\\').join('/'), text, cfg.guards));
  }
  // Committed, not under .faithful/: the baseline is a decision the team reviews, and a
  // loosened one shows up in the diff (a verifier the agent can quietly edit is no verifier).
  const bpath = resolve(cwd, BASELINE);
  if (opts.updateBaseline) await writeFile(bpath, `${JSON.stringify(countViolations(violations), null, 1)}\n`);
  const hasBaseline = existsSync(bpath);
  const base = hasBaseline ? JSON.parse(await readFile(bpath, 'utf8')) : {};
  const r = ratchet(violations, base);
  return { violations, regressions: r.regressions, improved: r.improved, files: files.length, baseline: hasBaseline };
}

/** The guard result as the few lines an agent reads. Shared by the CLI and the MCP server. */
export function formatGuard(r: GuardResult, max = 8, updated = false): { pass: boolean; text: string } {
  if (updated)
    return {
      pass: true,
      text: `baseline written: ${r.violations.length} existing violations in ${r.files} files are allowed to stay, never to grow`,
    };
  if (!r.regressions.length) {
    const tighten = r.improved.length
      ? ` · ${r.improved.length} files improved: run with --update-baseline to lock it in`
      : '';
    return { pass: true, text: `guard PASS · ${r.files} files${r.baseline ? ' (with baseline)' : ''}${tighten}` };
  }
  const lines = r.regressions.flatMap((g) => g.lines.slice(0, 3).map((l) => `${l.file}:${l.line} ${l.rule} ${l.text}`));
  const out = [`guard FAIL · ${r.regressions.length} file/rule pairs got worse`, ...lines.slice(0, max * 2)];
  if (lines.length > max * 2) out.push(`+${lines.length - max * 2} more`);
  return { pass: false, text: out.join('\n') };
}

/** Outline a design file or a folder of them. Shared by the CLI and the MCP server. */
export async function outlineAny(target: string, cfg: FaithfulConfig, viewports?: string): Promise<string> {
  if (existsSync(target) && statSync(target).isDirectory()) return outlineFolder(target);
  const s = new Session(cfg);
  try {
    return outline(await readDesign(target, s, parseViewports(viewports, cfg.viewports)));
  } finally {
    await s.close();
  }
}

// ── Audit: a page judged on its own ─────────────────────────────────────────

/** A phone and a desktop: most layout faults show at one and not the other. */
export const AUDIT_VIEWPORTS = '375x812,1440x900';

export interface AuditRunOptions {
  target: string;
  viewports?: string;
  config?: FaithfulConfig;
  cwd?: string;
}

/** Render a page at each viewport and judge it with no design: faults, readability, tells. */
export async function audit(o: AuditRunOptions): Promise<RunResult> {
  const cfg = o.config ?? (await loadConfig(o.cwd));
  const session = new Session(cfg);
  try {
    const vps = parseViewports(o.viewports ?? AUDIT_VIEWPORTS, cfg.viewports);
    const target = isUrl(o.target)
      ? { url: o.target }
      : {
          html: await readFile(resolve(o.cwd ?? process.cwd(), o.target), 'utf8'),
          baseDir: resolve(o.cwd ?? process.cwd(), o.target, '..'),
        };
    const results: ScreenResult[] = [];
    for (const vp of vps) {
      const facts = await (await session.browser()).audit(target, vp);
      results.push(scoreAudit(facts, `audit@${vp.width}`, { minTarget: Math.min(cfg.minTarget, 24) }));
    }
    mergeViewports(results);
    const provenance = {
      adapter: 'audit',
      adapterVersion: '0.1.0',
      format: 'audit@1',
      tier: 'rendered' as const,
      confidence: 1,
      source: o.target,
      warnings: [] as string[],
    };
    await withDeviations(results, o.cwd);
    const run = summarise(results, provenance, 'audit', 0);
    await save(run, o.cwd);
    return run;
  } finally {
    await session.close();
  }
}

// ── Parity: the same product after a refactor or a redesign ──────────────────

export interface ParityOptions {
  before: string;
  after: string;
  /** Paths to compare on both, e.g. ["/", "/pricing"]. Default: the before page plus the same-origin pages it links to. */
  pages?: string[];
  maxPages?: number;
  viewports?: string;
  config?: FaithfulConfig;
  cwd?: string;
}

/**
 * Compare what users can DO on BEFORE and AFTER: controls, forms, landmarks, routes, script
 * errors. Two URLs are crawled one level from the before page, so a route that answered
 * before and 404s after is caught; two files are one page each.
 */
export async function parity(o: ParityOptions): Promise<RunResult> {
  const cfg = o.config ?? (await loadConfig(o.cwd));
  const session = new Session(cfg);
  const cwd = o.cwd ?? process.cwd();
  const targetOf = async (s: string, path?: string) =>
    isUrl(s)
      ? { url: path ? new URL(path, s).href : s }
      : { html: await readFile(resolve(cwd, s), 'utf8'), baseDir: resolve(cwd, s, '..') };
  try {
    const vps = parseViewports(o.viewports ?? '1280x800', cfg.viewports);
    const browser = await session.browser();
    const results: ScreenResult[] = [];
    const urls = isUrl(o.before) && isUrl(o.after);
    for (const vp of vps) {
      const first = await browser.audit(await targetOf(o.before), vp);
      let pages: (string | undefined)[] = [undefined];
      if (urls) {
        const linked = first.controls
          .map((c) => (c.href ? normHref(c.href, first.url) : ''))
          .filter((h) => h.startsWith('/') && !h.includes('#'));
        const start = new URL(o.before).pathname;
        pages = [...new Set([start, ...(o.pages ?? linked)])].slice(0, o.maxPages ?? 12);
      }
      for (const path of pages) {
        const b =
          path === undefined || path === new URL(isUrl(o.before) ? o.before : 'http://x/').pathname
            ? first
            : await browser.audit(await targetOf(o.before, path), vp);
        if ((b.runtime?.status ?? 200) >= 400) continue;
        const a = await browser.audit(await targetOf(o.after, path), vp);
        const r = compareParity(b, a, `${path ?? 'page'}@${vp.width}`);
        const check = selfCheck(b);
        if (!check.ok)
          r.findings.push({
            kind: 'unmeasured',
            severity: 'warn',
            detail: `inconclusive for ${path ?? 'this page'}: ${check.reason}`,
            screen: r.screen,
            viewport: r.viewport,
          });
        results.push(r);
      }
    }
    const provenance = {
      adapter: 'parity',
      adapterVersion: '0.1.0',
      format: 'parity@1',
      tier: 'rendered' as const,
      confidence: 1,
      source: `${o.before} → ${o.after}`,
      warnings: [] as string[],
    };
    await withDeviations(results, o.cwd);
    const run = summarise(results, provenance, 'parity', 0);
    await save(run, o.cwd);
    return run;
  } finally {
    await session.close();
  }
}

/** The team's declared deviations, applied to every finding of a run before it is judged. */
export async function withDeviations(results: ScreenResult[], cwd = process.cwd()): Promise<ScreenResult[]> {
  const path = resolve(cwd, DEVIATIONS);
  if (!existsSync(path)) return results;
  let devs: ReturnType<typeof parseDeviations>;
  try {
    devs = parseDeviations(JSON.parse(await readFile(path, 'utf8')));
  } catch (e) {
    throw new FaithfulError((e as Error).message);
  }
  // Applied across the run, so an entry is "unused" only when NO screen needed it.
  const counts = results.map((r) => r.findings.length);
  const all = applyDeviations(
    results.flatMap((r) => r.findings),
    devs,
  );
  let i = 0;
  results.forEach((r, k) => {
    r.findings = all.slice(i, i + (counts[k] as number));
    i += counts[k] as number;
  });
  if (results[0]) results[0].findings.push(...all.slice(i));
  return results;
}
