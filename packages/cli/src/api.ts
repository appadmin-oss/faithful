/**
 * The programmatic API: everything the CLI and the MCP server do, as functions. Both are thin
 * shells over this, so an agent gets the same answer whichever door it uses.
 */
import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS } from '@usefaithful/adapters';
import { BrowserError, Renderer } from '@usefaithful/browser';
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
  rescoreDeclared,
  resolveConfig,
  type ScreenResult,
  type SourceInput,
  STRESS_CAUSE,
  type StressMode,
  scanFile,
  scoreAudit,
  selfCheck,
  stressDelta,
  summarise,
  type Violation,
} from '@usefaithful/core';
import type { FaithfulSpec, Inventory, Viewport } from '@usefaithful/spec';

export const OUT_DIR = '.faithful';
export const BASELINE = 'faithful.baseline.json';
export const DEVIATIONS = 'faithful.deviations.json';

export class FaithfulError extends Error {
  override readonly name = 'FaithfulError';
}

/** Read a JSON file Faithful owns; a syntax error names the file, not just a position. */
async function readJson(path: string, name: string): Promise<unknown> {
  const raw = await readFile(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new FaithfulError(`${name} is not valid JSON: ${(e as Error).message}`);
  }
}

/** Read `faithful.config.json` from `cwd` (or defaults). */
export async function loadConfig(cwd = process.cwd(), file?: string): Promise<FaithfulConfig> {
  const name = file ?? 'faithful.config.json';
  const path = resolve(cwd, name);
  if (!existsSync(path)) {
    if (file) throw new FaithfulError(`config not found: ${file}`);
    return structuredClone(DEFAULT_CONFIG);
  }
  const json = await readJson(path, name);
  try {
    return resolveConfig(json);
  } catch (e) {
    throw new FaithfulError(`${name}: ${(e as Error).message}`);
  }
}

/** `--max`: how many findings to list. A typo is a bad call, not an empty report. */
export function parseMax(s: string | undefined, fallback: number): number {
  if (s === undefined || s === '') return fallback;
  if (!/^\d+$/.test(s.trim()) || Number(s) < 1)
    throw new FaithfulError(`--max must be a positive whole number, got "${s}"`);
  return Number(s);
}

export const isUrl = (s: string): boolean => /^https?:\/\//i.test(s);

/** A `file://` URL is a path on disk: read it as one, not as a name relative to the cwd. */
export const localPath = (s: string): string => (/^file:\/\//i.test(s) ? fileURLToPath(s) : s);

/** Parse `1440x900,390x844` (or a single width) into viewports. */
export function parseViewports(s: string | undefined, fallback: Viewport[]): Viewport[] {
  if (!s) return fallback;
  return s.split(',').map((p) => {
    const m = /^(\d+)(?:x(\d+))?(?::(phone|tablet|desktop))?$/.exec(p.trim());
    if (!m) throw new FaithfulError(`bad viewport "${p}": use WIDTHxHEIGHT, e.g. 1440x900, or 1024x768:tablet`);
    const width = Number(m[1]);
    const vp: Viewport = { width, height: m[2] ? Number(m[2]) : width < 600 ? 844 : 900 };
    if (m[3]) vp.device = m[3] as NonNullable<Viewport['device']>;
    return vp;
  });
}

export type ColorScheme = 'light' | 'dark';

/**
 * `--color-scheme`: which `prefers-color-scheme` the page is rendered with. `both` (audit
 * only) renders every viewport twice. Anything else is a bad call, not a silent light run.
 */
export function parseColorScheme(s: string | undefined, allowBoth = false): ColorScheme[] {
  if (s === undefined || s === '') return ['light'];
  const v = s.trim().toLowerCase();
  if (v === 'light' || v === 'dark') return [v];
  if (v === 'both' && allowBoth) return ['light', 'dark'];
  throw new FaithfulError(`--color-scheme must be light${allowBoth ? ', dark or both' : ' or dark'}, got "${s}"`);
}

/**
 * The passes every audit runs unless told otherwise: enlarged text and 320px reflow. A layout
 * that only holds at the author's own text size and window is the fault no screenshot shows
 * (MAM Academy, Nov 2026: a nav that wrapped and cut off its last button at 175% text).
 */
export const DEFAULT_STRESS: readonly StressMode[] = ['zoom', 'reflow'];

/**
 * `--stress`: the i18n / resilience passes an audit runs IN ADDITION to the normal one, as a
 * comma list (CLI) or an array (MCP). Omitted: `DEFAULT_STRESS`; `none` (CLI): no extra pass.
 * An unknown name is a bad call, never silently skipped.
 */
export function parseStress(s: string | readonly string[] | undefined): StressMode[] {
  if (s === undefined) return [...DEFAULT_STRESS];
  if (typeof s === 'string' && s.trim().toLowerCase() === 'none') return [];
  const names = (typeof s === 'string' ? s.split(',') : [...s]).map((x) => x.trim().toLowerCase());
  const known = Object.keys(STRESS_CAUSE) as StressMode[];
  const out: StressMode[] = [];
  for (const n of names) {
    if (!known.includes(n as StressMode))
      throw new FaithfulError(
        `--stress takes a comma list of ${known.join(', ')}; got "${typeof s === 'string' ? s : s.join(',')}"`,
      );
    if (!out.includes(n as StressMode)) out.push(n as StressMode);
  }
  return out;
}

/** A storage-state path, resolved against the caller's folder; a missing file is a bad call. */
function sessionFile(path: string, cwd?: string): string {
  const p = resolve(cwd ?? process.cwd(), path);
  if (!existsSync(p)) throw new FaithfulError(`--storage-state: not found: ${path}`);
  return p;
}

/** One browser for the whole run, launched only if something needs it. */
export class Session {
  private renderer: Promise<Renderer> | null = null;
  readonly warnings: string[] = [];
  constructor(
    readonly config: FaithfulConfig,
    readonly colorScheme: ColorScheme = 'light',
    /** `verify --scroll`: every page this session reads, design and build alike, is scrolled this far. */
    readonly scrollY = 0,
    /** `verify --physics`: every page is watched coming in, and how each element moved is kept. */
    readonly physics = false,
  ) {}

  /** `--storage-state`: a signed-in session every page of the run is opened with. */
  storageState?: string;

  browser(): Promise<Renderer> {
    this.renderer ??= Renderer.launch().then((r) => {
      if (this.storageState) r.storageState = this.storageState;
      return r;
    });
    return this.renderer;
  }

  /** `asPage`: what is rendered is the build, a deployed page (see deviceContext). */
  context(viewports: Viewport[], asPage = false): ReadContext {
    return {
      viewports,
      render: async (target, vp, id) =>
        (await this.browser()).capture(target, vp, id, {
          ignore: this.config.ignore,
          colorScheme: this.colorScheme,
          ...(this.scrollY ? { scrollY: this.scrollY } : {}),
          ...(this.physics ? { physics: true } : {}),
          ...(asPage ? { asPage } : {}),
        }),
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
  /**
   * A Playwright storage-state file (cookies and localStorage of a signed-in session), for
   * pages behind a login: an admin console, a member's portal. Read, never written back.
   */
  storageState?: string;
  design: string;
  build: string;
  viewports?: string;
  /** Extra conformity sources: a copy deck, a token file, a DESIGN.md. */
  also?: string[];
  /** `light` (default) or `dark`: design and build are both rendered with it. */
  colorScheme?: string;
  /** Compare only this screen (a canvas board, a Figma frame): its id, as `outline` lists it. */
  screen?: string;
  /**
   * `--scroll 0,900`: compare at each scroll position, design and build scrolled alike, so a
   * state reached by scrolling (a header that swaps after the hero) is checked too. Default 0.
   */
  scroll?: string | readonly number[];
  /**
   * `--physics`: watch both pages come in, frame by frame, and compare how each element moved —
   * distance, time to rest, overshoot (a spring's stiffness and damping), curve. Slower: each
   * page is loaded with motion on and waited on until it comes to rest.
   */
  physics?: boolean;
  config?: FaithfulConfig;
  cwd?: string;
}

/** `--scroll`: whole pixel offsets, comma-separated, each ≥ 0; anything else is a bad call. */
export function parseScroll(s: string | readonly number[] | undefined): number[] {
  if (s === undefined) return [0];
  const raw = typeof s === 'string' ? s.split(',').map((x) => x.trim()) : s.map(String);
  const out: number[] = [];
  for (const x of raw) {
    if (!/^\d{1,6}$/.test(x))
      throw new FaithfulError(
        `--scroll takes pixel offsets like 0,900; got "${typeof s === 'string' ? s : s.join(',')}"`,
      );
    if (!out.includes(Number(x))) out.push(Number(x));
  }
  return out.length ? out : [0];
}

/** A screen's board: `home@1440` and `home@390` are one board at two viewports. */
const boardOf = (id: string): string => id.replace(/@\d+$/, '');

/**
 * The design screens one build is compared with. A canvas of several DIFFERENT boards is
 * several pages, and one build is one of them: without `screen` that is a bad call naming the
 * ids, never a run that fails on every other page. Other formats (a Figma file of Desktop and
 * Mobile frames) keep comparing every screen unless `screen` narrows them. One board at
 * several viewports is one page, and every viewport is compared.
 */
export function pickScreens<T extends { id: string }>(
  screens: T[],
  screen: string | undefined,
  design: string,
  boardsArePages = true,
): T[] {
  const ids = [...new Set(screens.map((s) => boardOf(s.id)))];
  if (screen !== undefined) {
    const want = screen.trim();
    const hit = screens.filter((s) => s.id === want || boardOf(s.id) === want);
    if (!hit.length)
      throw new FaithfulError(
        `--screen ${want}: ${design} has no such screen. Screens: ${ids.join(', ') || 'none (nothing to place)'}`,
      );
    return hit;
  }
  if (boardsArePages && ids.length > 1)
    throw new FaithfulError(
      `${design} has ${ids.length} screens; one build is one of them. Pick it with --screen <id>: ${ids.join(', ')}`,
    );
  return screens;
}

/**
 * Compare a build with a design. Placed comparison per design screen at its own viewport;
 * when the design could not be placed (tokens, a copy deck, a DESIGN.md), conformity instead.
 * Extra sources add conformity checks to a placed run.
 */
export async function verify(o: VerifyOptions): Promise<RunResult> {
  const cfg = o.config ?? (await loadConfig(o.cwd));
  const c = await collect({ ...o, config: cfg });
  await withDeviations(c.results, o.cwd);
  const run = summarise(c.results, c.provenance, c.mode, cfg.passScore);
  await save(run, o.cwd);
  return run;
}

/**
 * `faithful verify` with no design: every page in the config's `checks`, in one run and one
 * verdict, each screen named by its check. A check that cannot run is a bad call naming it.
 */
export async function verifyChecks(o: { config?: FaithfulConfig; cwd?: string } = {}): Promise<RunResult> {
  const cfg = o.config ?? (await loadConfig(o.cwd));
  if (!cfg.checks.length)
    throw new FaithfulError(
      'nothing to verify: name a design (`faithful verify <design> --build <url>`), or list the pages in faithful.config.json "checks"',
    );
  const results: ScreenResult[] = [];
  let first: Awaited<ReturnType<typeof collect>> | undefined;
  for (const [i, ch] of cfg.checks.entries()) {
    if (typeof ch?.design !== 'string' || typeof ch?.build !== 'string')
      throw new FaithfulError(`faithful.config.json checks[${i}] needs a "design" and a "build"`);
    const name = ch.name ?? ch.build;
    const c = await collect({
      design: ch.design,
      build: ch.build,
      config: cfg,
      ...(o.cwd ? { cwd: o.cwd } : {}),
      ...(ch.viewports ? { viewports: ch.viewports } : {}),
      ...(ch.screen ? { screen: ch.screen } : {}),
      ...(ch.scroll ? { scroll: ch.scroll } : {}),
    });
    first ??= c;
    for (const r of c.results) {
      r.screen = `${name} · ${r.screen}`;
      for (const f of r.findings) f.screen = r.screen;
    }
    results.push(...c.results);
  }
  const done = first as NonNullable<typeof first>;
  await withDeviations(results, o.cwd);
  const run = summarise(results, done.provenance, done.mode, cfg.passScore);
  await save(run, o.cwd);
  return run;
}

/** Every scroll position of one verification, its screens labelled by position. */
async function collect(o: VerifyOptions & { config: FaithfulConfig }) {
  const scrolls = parseScroll(o.scroll);
  const results: ScreenResult[] = [];
  let first: Awaited<ReturnType<typeof compareAt>> | undefined;
  for (const y of scrolls) {
    const at = await compareAt(o, y);
    first ??= at;
    // A scrolled state is its own screen in the report: `home@1440 scrolled 900`.
    if (y)
      for (const r of at.results) {
        r.screen = `${r.screen} scrolled ${y}`;
        for (const f of r.findings) f.screen = r.screen;
      }
    results.push(...at.results);
  }
  const done = first as NonNullable<typeof first>;
  return { results, provenance: done.provenance, mode: done.mode };
}

/** One verification at one scroll position: the design and the build read and compared. */
async function compareAt(o: VerifyOptions, scrollY: number) {
  o = {
    ...o,
    design: localPath(o.design),
    build: localPath(o.build),
    ...(o.also ? { also: o.also.map(localPath) } : {}),
  };
  const cfg = o.config ?? (await loadConfig(o.cwd));
  const [scheme] = parseColorScheme(o.colorScheme);
  const session = new Session(cfg, scheme, scrollY, o.physics === true);
  if (o.storageState) session.storageState = sessionFile(o.storageState, o.cwd);
  // Every path is read against the caller's folder, as audit and parity read theirs: an MCP
  // server started elsewhere must not compare some other design.html.
  const cwd = o.cwd ?? process.cwd();
  const at = (p: string) => (isUrl(p) ? p : resolve(cwd, p));
  try {
    const vps = parseViewports(o.viewports, cfg.viewports);
    const design = await readDesign(at(o.design), session, vps);
    const extra: Inventory[] = [];
    for (const a of o.also ?? []) {
      const s = await readDesign(at(a), session, vps);
      if (s.inventory) extra.push(s.inventory);
      for (const sc of s.screens) extra.push(inventoryOf(sc));
      design.provenance.warnings.push(...s.provenance.warnings.map((w) => `${a}: ${w}`));
    }
    // The build is rendered as the design is (touch on phones and tablets, no 980px fallback):
    // verify compares like with like. A missing viewport meta is audit's finding, not verify's.
    const ctx = session.context(vps);
    if (!isUrl(o.build) && !existsSync(at(o.build))) throw new FaithfulError(`not found: ${o.build}`);
    const buildTarget = isUrl(o.build)
      ? { url: o.build }
      : { html: await readFile(at(o.build), 'utf8'), baseDir: resolve(at(o.build), '..') };
    const results: ScreenResult[] = [];
    const placed = pickScreens(
      design.screens.filter((s) => s.elements.length > 0),
      o.screen,
      o.design,
      design.provenance.adapter === 'claude-canvas',
    );
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
    return {
      results,
      provenance: design.provenance,
      mode: placed.length ? ('placed' as const) : ('conformity' as const),
    };
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
  return (await readJson(path, `${OUT_DIR}/last.json`)) as RunResult;
}

/** A compact outline of a design: what an agent needs before it builds, in few tokens. */
export function outline(s: FaithfulSpec, maxTexts = 24): string {
  const p = s.provenance;
  const lines = [`${p.format} via ${p.adapter} · ${p.tier} · confidence ${p.confidence}`];
  for (const sc of s.screens) {
    const kinds: Record<string, number> = {};
    for (const e of sc.elements) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    lines.push(
      `screen ${sc.id}${sc.name && sc.name !== sc.id ? ` "${sc.name}"` : ''} ${sc.viewport.width}x${sc.viewport.height}${sc.pageHeight ? ` (page ${sc.pageHeight}px)` : ''}: ${
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
  if (only?.length)
    return only.map((f) => {
      const rel = relative(root, resolve(root, f));
      // Only the project's own files: a path that climbs out of it, or names another drive, is refused.
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
        throw new FaithfulError(`${f} is outside the project folder (${root}); guard scans only files inside it`);
      return rel;
    });
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
  const base = hasBaseline ? await readJson(bpath, BASELINE) : {};
  if (typeof base !== 'object' || base === null || Array.isArray(base))
    throw new FaithfulError(`${BASELINE} should be an object of rule → file → count`);
  const r = ratchet(violations, base as Parameters<typeof ratchet>[1]);
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
  target = localPath(target);
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
  /**
   * A Playwright storage-state file (cookies and localStorage of a signed-in session), for
   * pages behind a login: an admin console, a member's portal. Read, never written back.
   */
  storageState?: string;
  target: string;
  viewports?: string;
  /** `light` (default), `dark`, or `both`: every viewport in each, screens labelled `audit@375 dark`. */
  colorScheme?: string;
  /**
   * `expand` (pseudo-localised text, 1.3–2× longer), `rtl` (dir="rtl"), `spacing` (WCAG 1.4.12):
   * each an extra pass per viewport, screens labelled `audit@375 expand`, reporting only the
   * layout faults it adds over the normal pass.
   */
  stress?: string | readonly string[];
  /** `false` (`--no-axe`): skip axe-core's WCAG rules this run. Default: the config's `audit.axe`. */
  axe?: boolean;
  config?: FaithfulConfig;
  cwd?: string;
}

/** Render a page at each viewport and judge it with no design: faults, readability, tells. */
export async function audit(o: AuditRunOptions): Promise<RunResult> {
  o = { ...o, target: localPath(o.target) };
  const cfg = o.config ?? (await loadConfig(o.cwd));
  const schemes = parseColorScheme(o.colorScheme, true);
  const stresses = parseStress(o.stress);
  const axeOn = o.axe !== false && cfg.audit.axe;
  const session = new Session(cfg);
  if (o.storageState) session.storageState = sessionFile(o.storageState, o.cwd);
  try {
    const vps = parseViewports(o.viewports ?? AUDIT_VIEWPORTS, cfg.viewports);
    const target = isUrl(o.target)
      ? { url: o.target }
      : {
          html: await readFile(resolve(o.cwd ?? process.cwd(), o.target), 'utf8'),
          baseDir: resolve(o.cwd ?? process.cwd(), o.target, '..'),
        };
    const results: ScreenResult[] = [];
    const narrowest = vps.reduce((a, b) => (b.width < a.width ? b : a));
    const opts = { minTarget: Math.min(cfg.minTarget, 24), navMax: cfg.audit.navMax };
    for (const scheme of schemes)
      for (const vp of vps) {
        const browser = await session.browser();
        const facts = await browser.audit(target, vp, { colorScheme: scheme, axe: axeOn });
        // Light is the default and stays unlabelled; a dark (or two-scheme) run says which is which.
        const named = schemes.length > 1 || scheme === 'dark' ? ` ${scheme}` : '';
        const r = scoreAudit(facts, `audit@${vp.width}${named}`, opts);
        if (named) for (const f of r.findings) f.viewport = `${f.viewport}${named}`;
        results.push(r);
        for (const mode of stresses) {
          // Reflow narrows the window to 320, whatever it was: once per colour scheme, from the narrowest.
          if (mode === 'reflow' && vp !== narrowest) continue;
          const screen = `audit@${vp.width}${named} ${mode}`;
          let s: ScreenResult;
          try {
            const stressed = await browser.audit(target, vp, { colorScheme: scheme, stress: mode });
            s = stressDelta(r, scoreAudit(stressed, screen, opts), mode);
          } catch (e) {
            if (!(e instanceof BrowserError) || !/could not be applied/.test(e.message)) throw e;
            s = { ...r, screen, score: 97, findings: [] };
            s.findings.push({ kind: 'unmeasured', severity: 'warn', detail: e.message, screen });
          }
          for (const f of s.findings) f.viewport = `${f.viewport ?? `${vp.width}x${vp.height}`}${named} ${mode}`;
          results.push(s);
        }
      }
    mergeViewports(results);
    const provenance = {
      adapter: 'audit',
      adapterVersion: '0.1.0',
      format: 'audit@1',
      tier: 'rendered' as const,
      confidence: 1,
      source: o.target,
      // Said on every run it is off, so a clean report never hides that the WCAG rules were skipped.
      warnings: axeOn
        ? []
        : [`axe-core off (${o.axe === false ? '--no-axe' : 'audit.axe: false'}): WCAG rules unmeasured`],
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
  /**
   * A Playwright storage-state file (cookies and localStorage of a signed-in session), for
   * pages behind a login: an admin console, a member's portal. Read, never written back.
   */
  storageState?: string;
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
  o = { ...o, before: localPath(o.before), after: localPath(o.after) };
  const cfg = o.config ?? (await loadConfig(o.cwd));
  const session = new Session(cfg);
  if (o.storageState) session.storageState = sessionFile(o.storageState, o.cwd);
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
  const json = await readJson(path, DEVIATIONS);
  try {
    devs = parseDeviations(json);
  } catch (e) {
    throw new FaithfulError((e as Error).message);
  }
  // Applied across the run, so an entry is "unused" only when NO screen needed it.
  const counts = results.map((r) => r.findings.length);
  const before = results.flatMap((r) => r.findings);
  const all = applyDeviations(before, devs);
  // A declared finding gives back what it took from the score: a run whose every difference
  // was meant must not fail on the percentage those differences cost.
  const declared = new Set(before.filter((f, k) => f.severity !== 'info' && all[k]?.severity === 'info'));
  let i = 0;
  results.forEach((r, k) => {
    r.findings = all.slice(i, i + (counts[k] as number));
    i += counts[k] as number;
    rescoreDeclared(r, declared);
  });
  if (results[0]) results[0].findings.push(...all.slice(i));
  return results;
}
