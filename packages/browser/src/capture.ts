/**
 * Render a page and read it. One browser for a whole run (launching is the slowest thing
 * Faithful does), a fresh context per capture so nothing leaks between design and build, and
 * every source of nondeterminism switched off before the reading: animations and transitions
 * stopped, the caret hidden, reduced motion requested, web fonts awaited.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { type AuditFacts, FILE_ENTRY_DIR, FILE_ORIGIN, type Rendered, type RenderTarget } from '@usefaithful/core';
import { type DesignElement, deviceOf, type Region, type Screen, type Viewport } from '@usefaithful/spec';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright-core';
import { auditProbe } from './audit-probe.js';
import { AXE_TAGS, axeSource, runAxe } from './axe.js';
import { extractPage, type RawPage } from './extract.js';
import { chromeCandidates } from './find-chrome.js';
import { expandText, setRtl, setSpacing, zoomText } from './stress.js';

/**
 * The device a viewport stands for, as the browser must emulate it (measured in Chromium):
 * a phone or tablet has touch and no hover, so `(hover: none)` and `(pointer: coarse)` rules
 * apply; a 390px window without them is a narrow DESKTOP and shows the desktop design. A phone
 * rendering a deployed page (`asPage`) also honours its viewport meta tag, and without one lays
 * the page out at 980px, as a real phone does. A design board is not a deployed page, so it
 * never gets that fallback.
 */
export function deviceContext(v: Viewport, asPage: boolean): { hasTouch: boolean; isMobile: boolean } {
  const d = deviceOf(v);
  return { hasTouch: d !== 'desktop', isMobile: asPage && d === 'phone' };
}

/** `faithful audit --stress`: what the page is put through before it is measured. */
export type Stress = 'expand' | 'rtl' | 'spacing' | 'zoom' | 'reflow';
/** Passes that change the page; `reflow` changes the window instead (320 CSS px, WCAG 1.4.10). */
const STRESS = { expand: expandText, rtl: setRtl, spacing: setSpacing, zoom: zoomText } as const;
export const REFLOW_WIDTH = 320;

export interface CaptureOptions {
  ignore?: string[];
  /** Write a full-page PNG here. */
  screenshot?: string;
  colorScheme?: 'light' | 'dark';
  /** Hard ceiling on elements read; above it the result says it was truncated. */
  maxElements?: number;
  timeoutMs?: number;
  /** Ask the browser which font it actually drew each family with (slower; on by default). */
  fonts?: boolean;
  /**
   * Scroll the window this far down before reading it, so a state the page only reaches on
   * scroll (a header that swaps once the hero has passed) is what is read. Positions stay in
   * page coordinates, so a design and a build scrolled alike compare as at the top.
   */
  scrollY?: number;
  /** A deployed page rather than a design board: a phone honours (or lacks) its viewport meta. */
  asPage?: boolean;
}

const FREEZE = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}`;

// Shared with parity's normHref, which reads this private folder as the site root.
const ORIGIN = FILE_ORIGIN;
const ENTRY_DIR = FILE_ENTRY_DIR;
const ENTRY = `${ENTRY_DIR}index.html`;
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};
const mime = (f: string): string => TYPES[extname(f).toLowerCase()] ?? 'application/octet-stream';

export class BrowserError extends Error {
  override readonly name = 'BrowserError';
}

/** Starts a browser: `undefined` is Playwright's own build, a path is that executable. */
export type Launcher = (executablePath: string | undefined) => Promise<Browser>;
const defaultLauncher: Launcher = (exe) => chromium.launch(exe ? { executablePath: exe } : {});

/**
 * The order browsers are tried in: the user's explicit override (even a path that is not
 * there: the error then says so), Playwright's own build, then every other candidate that exists.
 */
export function launchPlan(): (string | undefined)[] {
  const explicit = [process.env.FAITHFUL_CHROMIUM, process.env.CHROME_PATH].filter((v): v is string => !!v);
  const rest = chromeCandidates().filter((p) => !explicit.includes(p) && existsSync(p));
  return [...new Set(explicit), undefined, ...new Set(rest)];
}

/**
 * A promise bounded by the capture's timeout. `page.evaluate` has no timeout of its own: a
 * page that busy-loops after load would otherwise hang the run (and the MCP server) forever.
 */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new BrowserError(`the page did not answer within ${ms}ms (${what}): is a script stuck in a loop?`)),
      ms,
    );
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}
/** Swallow a page's own failure, never a timeout. */
const unlessHung = (e: unknown): undefined => {
  if (e instanceof BrowserError) throw e;
  return undefined;
};

export class Renderer {
  private constructor(private readonly browser: Browser) {}

  /**
   * Start a Chromium: an explicit FAITHFUL_CHROMIUM / CHROME_PATH first (the user asked for
   * it), then Playwright's own build, then every other browser this machine has, until one
   * starts. A stale override or a broken download never blocks a working browser behind it,
   * and when none starts the error names every attempt.
   */
  static async launch(start: Launcher = defaultLauncher): Promise<Renderer> {
    const errors: string[] = [];
    for (const exe of launchPlan()) {
      try {
        return new Renderer(await start(exe));
      } catch (e) {
        errors.push(`${exe ?? "Playwright's Chromium"}: ${(e as Error).message.split('\n')[0] ?? String(e)}`);
      }
    }
    throw new BrowserError(
      `No Chromium could be started. Install one with \`npx playwright install chromium --only-shell\`, or set FAITHFUL_CHROMIUM to a Chrome executable.\nLooked in: ${chromeCandidates().slice(0, 6).join(', ')}…\n${errors.join('\n')}`,
    );
  }

  async close(): Promise<void> {
    await this.browser.close();
  }

  async capture(
    target: RenderTarget,
    viewport: Viewport,
    screenId: string,
    opts: CaptureOptions = {},
  ): Promise<Rendered> {
    const ctx: BrowserContext = await this.browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      ...deviceContext(viewport, opts.asPage === true),
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
      colorScheme: opts.colorScheme ?? 'light',
      locale: 'en-GB',
      timezoneId: 'UTC',
    });
    const timeout = opts.timeoutMs ?? 30_000;
    ctx.setDefaultTimeout(timeout);
    try {
      const page = await ctx.newPage();
      if (target.initScript) await page.addInitScript({ content: target.initScript });
      await this.load(page, target, timeout);
      await this.settle(page, target, timeout);
      if (opts.scrollY) await this.scrolled(page, target, opts.scrollY, timeout);
      const raw: RawPage = await within(
        inWorld<RawPage>(page, extractPage, { ignore: opts.ignore ?? [], max: opts.maxElements ?? 4000 }),
        timeout,
        'reading the page',
      );
      if (opts.fonts !== false) await within(this.drawnFonts(page, raw), timeout, 'reading drawn fonts');
      if (opts.screenshot)
        await page.screenshot({ path: opts.screenshot, fullPage: true, animations: 'disabled', caret: 'hide' });
      const screen: Rendered = toScreen(raw, viewport, screenId);
      // The handoff's own probe reads the page's own variables, so it runs in the page's world.
      if (target.probe)
        screen.probe = await within(page.evaluate(target.probe), timeout, 'probing the handoff').catch((e: Error) => {
          if (e instanceof BrowserError) throw e;
          return { error: e.message };
        });
      return screen;
    } finally {
      await closeContext(ctx, timeout);
    }
  }

  /**
   * Render a page and measure it for `faithful audit`: no design, so no element extraction —
   * the audit probe's facts, plus what only the browser sees (script errors, failed requests).
   */
  async audit(
    target: RenderTarget,
    viewport: Viewport,
    opts: {
      timeoutMs?: number;
      colorScheme?: 'light' | 'dark';
      screenshot?: string;
      stress?: Stress;
      /** Run axe-core's WCAG 2.2 A/AA rules too (off by default: parity has no use for them). */
      axe?: boolean;
      /** Evaluated instead of the bundled axe-core build: lets a test break it. */
      axeScript?: string;
    } = {},
  ): Promise<AuditFacts> {
    const ctx: BrowserContext = await this.browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      // An audited page is a deployed page: a phone honours its viewport meta, or lacks one.
      ...deviceContext(viewport, true),
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
      colorScheme: opts.colorScheme ?? 'light',
      locale: 'en-GB',
      timezoneId: 'UTC',
    });
    const timeout = opts.timeoutMs ?? 30_000;
    ctx.setDefaultTimeout(timeout);
    const errors: string[] = [];
    const failed: { url: string; status: number }[] = [];
    try {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('response', (r) => {
        if (r.status() >= 400) failed.push({ url: r.url(), status: r.status() });
      });
      page.on('requestfailed', (r) => failed.push({ url: r.url(), status: 0 }));
      let status: number | undefined;
      page.on('response', (r) => {
        if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) status = r.status();
      });
      if (target.initScript) await page.addInitScript({ content: target.initScript });
      await this.load(page, target, timeout);
      await this.settle(page, target, timeout);
      if (opts.stress === 'reflow') {
        // The window narrowed to 320 CSS px after load, as a 1280 screen at 400% zoom lays out.
        await page.setViewportSize({ width: REFLOW_WIDTH, height: page.viewportSize()?.height ?? 800 });
        await this.settle(page, target, timeout);
      } else if (opts.stress) {
        // Mutated from the isolated world: the DOM is shared, so the page lays out the change.
        const done = await within(
          inWorld<{ applied: boolean }>(page, STRESS[opts.stress]),
          timeout,
          'stressing the page',
        );
        if (!done.applied)
          throw new BrowserError(
            `the ${opts.stress} pass could not be applied to this page, so what it would find is unmeasured`,
          );
        await within(
          page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))),
          timeout,
          'waiting for layout',
        );
      }
      const facts: AuditFacts = await within(inWorld<AuditFacts>(page, auditProbe), timeout, 'measuring the page');
      if (opts.screenshot)
        await page.screenshot({ path: opts.screenshot, fullPage: true, animations: 'disabled', caret: 'hide' });
      // Last, after the probe and the screenshot, so nothing axe touches can change them. A stress
      // pass reports layout faults only, so it never runs axe. Any failure, a slow page included,
      // is recorded as unmeasured rather than failing the run or passing silently.
      if (opts.axe && !opts.stress)
        facts.axe = await within(
          // Deferred so a missing axe-core build is caught below, like any other failure.
          Promise.resolve().then(() =>
            inWorld<NonNullable<AuditFacts['axe']>>(page, runAxe, [...AXE_TAGS], opts.axeScript ?? axeSource()),
          ),
          timeout,
          'running axe-core',
        ).catch((e: Error) => ({ error: e.message || String(e) }));
      // The private origin's own favicon probe is not the page's fault.
      facts.device = deviceOf(viewport);
      facts.runtime = {
        errors,
        failed: failed.filter((f) => !/\/favicon\.ico$/.test(f.url)),
        ...(status === undefined ? {} : { status }),
      };
      return facts;
    } finally {
      await closeContext(ctx, timeout);
    }
  }

  /** Freeze motion, wait for the page's own readiness, fonts and two frames; all bounded. */
  /**
   * Scroll to exactly `y` (a wheel keeps coasting past it) and give the page's scroll handlers
   * and observers their frames: a header that slides in on scroll has done so when this returns.
   */
  private async scrolled(page: Page, target: RenderTarget, y: number, timeout: number): Promise<void> {
    await within(
      page.evaluate((to) => {
        window.scrollTo(0, to);
        window.dispatchEvent(new Event('scroll'));
      }, y),
      timeout,
      'scrolling',
    );
    await page.waitForTimeout(250);
    await this.settle(page, target, timeout);
  }

  private async settle(page: Page, target: RenderTarget, timeout: number): Promise<void> {
    await within(page.addStyleTag({ content: FREEZE }), timeout, 'freezing animations').catch(unlessHung);
    if (target.readyWhen) await page.waitForFunction(target.readyWhen, undefined, { timeout }).catch(() => undefined);
    await within(
      page.evaluate(() => document.fonts?.ready.then(() => undefined)),
      timeout,
      'waiting for fonts',
    ).catch(unlessHung);
    // Two frames for layout that settles after fonts (a ResizeObserver, a measured header).
    await within(
      page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))),
      timeout,
      'waiting for layout',
    );
  }

  private async load(page: Page, target: RenderTarget, timeout: number): Promise<void> {
    if (target.url) {
      await page.goto(target.url, { waitUntil: 'load', timeout });
    } else if (target.html !== undefined) {
      // Served from a private origin rather than set as content: init scripts then run as on
      // any page, and relative stylesheets, scripts and images resolve against `baseDir` —
      // never outside it.
      const base = target.baseDir ? resolve(target.baseDir) : undefined;
      const site = target.siteRoot ? resolve(target.siteRoot) : base;
      const html = target.html;
      const inside = (dir: string | undefined, file: string) => !!dir && (file === dir || file.startsWith(dir + sep));
      // Nothing in this handler may throw: a rejection here is unhandled and takes the whole
      // process down (the CLI and the MCP server with it).
      await page.route(`${ORIGIN}/**`, async (route) => {
        const notFound = () => route.fulfill({ status: 404, body: '' }).catch(() => undefined);
        try {
          const raw = new URL(route.request().url()).pathname;
          // `100%.png` or a page's `fetch('/%')` is not valid percent-encoding: read it literally.
          let path: string;
          try {
            path = decodeURIComponent(raw);
          } catch {
            path = raw;
          }
          if (path === ENTRY)
            return await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
          // `./data.js` beside the page resolves under the entry's folder; `/assets/x.png` is
          // the site root's. Neither may leave its own directory.
          const rel = path.startsWith(ENTRY_DIR) ? path.slice(ENTRY_DIR.length) : null;
          const dir = rel !== null ? base : site;
          const file = dir ? resolve(dir, `.${rel !== null ? `/${rel}` : path}`) : undefined;
          if (!file || !inside(dir, file)) return await notFound();
          return await route.fulfill({ status: 200, contentType: mime(file), body: await readFile(file) });
        } catch {
          return notFound();
        }
      });
      await page.goto(`${ORIGIN}${ENTRY}`, { waitUntil: 'load', timeout });
    } else {
      throw new BrowserError('nothing to render: a target needs a url or html');
    }
    await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 5000) }).catch(() => undefined);
  }

  /**
   * Which font did the browser really draw each family with? A design font that failed to
   * load is replaced by a fallback silently — every computed style still says the design's
   * family — and no screenshot diff names the cause. The DevTools protocol does.
   */
  private async drawnFonts(page: Page, raw: RawPage): Promise<void> {
    const byFamily = new Map<string, number>();
    raw.elements.forEach((e, i) => {
      // Only an element whose text is all its own: a link holding a <b> in another face
      // reports both faces, and the busier one is not the one this family asked for.
      if (e.leaf && typeof e.style.fontFamily === 'string' && !byFamily.has(e.style.fontFamily))
        byFamily.set(e.style.fontFamily, i);
    });
    if (!byFamily.size) return;
    let cdp: import('playwright-core').CDPSession;
    try {
      cdp = await page.context().newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
    } catch {
      return; // not Chromium, or the protocol refused: the check is skipped, not failed
    }
    try {
      const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
      for (const [family, i] of byFamily) {
        const el = raw.elements[i];
        if (!el) continue;
        try {
          const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: el.id });
          if (!nodeId) continue;
          const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
          const used = [...fonts].sort((a, b) => b.glyphCount - a.glyphCount)[0]?.familyName;
          if (!used) continue;
          for (const e of raw.elements) if (e.style.fontFamily === family) e.style.renderedFont = used;
        } catch {
          /* a selector the protocol cannot resolve: leave that family unchecked */
        }
      }
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  }
}

/** Close a capture's context, even one whose page is stuck; never wait on it past the timeout. */
async function closeContext(ctx: BrowserContext, timeout: number): Promise<void> {
  await within(ctx.close(), timeout, 'closing the page').catch(() => undefined);
}

/**
 * Run a self-contained probe in an ISOLATED world: same DOM, but its own copies of every
 * global and prototype, so a page that overrides getComputedStyle, getBoundingClientRect or
 * naturalWidth cannot fake a clean reading. Falls back to the page's world only where the
 * DevTools protocol is not available.
 */
async function inWorld<T>(page: Page, fn: (arg: never) => T | Promise<T>, arg?: unknown, prelude = ''): Promise<T> {
  const call = `(${fn.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`;
  // A prelude (a library's source) is evaluated as script first, in the same world.
  const expression = prelude ? `${prelude}\n;${call}` : call;
  let cdp: import('playwright-core').CDPSession;
  try {
    cdp = await page.context().newCDPSession(page);
  } catch {
    return prelude ? page.evaluate<T>(expression) : page.evaluate(fn as (a: unknown) => T, arg);
  }
  try {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const { executionContextId } = await cdp.send('Page.createIsolatedWorld', {
      frameId: frameTree.frame.id,
      worldName: 'faithful-probe',
    });
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      contextId: executionContextId,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'probe failed');
    return r.result.value as T;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** Convert the page's raw reading into the spec's shape (typed, optional fields omitted). */
export function toScreen(raw: RawPage, viewport: Viewport, screenId: string): Screen {
  const elements: DesignElement[] = raw.elements.map((r) => {
    const s = r.style;
    const style: NonNullable<DesignElement['style']> = {};
    const set = <K extends keyof typeof style>(k: K, v: (typeof style)[K] | undefined) => {
      if (v !== undefined) style[k] = v;
    };
    set('color', str(s.color));
    set('background', str(s.background));
    set('fontSize', num(s.fontSize));
    set('fontWeight', num(s.fontWeight));
    set('fontFamily', str(s.fontFamily));
    set('lineHeight', num(s.lineHeight));
    set('letterSpacing', num(s.letterSpacing));
    set('textTransform', str(s.textTransform));
    set('radius', num(s.radius));
    set('borderColor', str(s.borderColor));
    set('borderWidth', num(s.borderWidth));
    set('opacity', num(s.opacity));
    set('renderedFont', str(s.renderedFont));
    const e: DesignElement = { id: r.id, kind: r.kind, box: r.box, style };
    if (r.text !== undefined) e.text = r.text;
    if (r.role !== undefined) e.role = r.role;
    if (r.region !== undefined) e.region = r.region;
    if (r.interactive) e.interactive = true;
    return e;
  });
  const regions: Region[] = raw.regions.map((g) => ({ id: g.id, name: g.name, box: g.box }));
  const screen: Screen = { id: screenId, name: screenId, viewport, elements, regions, pageHeight: raw.pageHeight };
  if (raw.fontFaces.length) screen.fontFaces = raw.fontFaces;
  return screen;
}
