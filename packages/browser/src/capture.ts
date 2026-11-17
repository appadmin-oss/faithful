/**
 * Render a page and read it. One browser for a whole run (launching is the slowest thing
 * Faithful does), a fresh context per capture so nothing leaks between design and build, and
 * every source of nondeterminism switched off before the reading: animations and transitions
 * stopped, the caret hidden, reduced motion requested, web fonts awaited.
 */
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { Rendered, RenderTarget } from '@faithful/core';
import type { DesignElement, Region, Screen, Viewport } from '@faithful/spec';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright-core';
import { extractPage, type RawPage } from './extract.js';
import { chromeCandidates, findChrome } from './find-chrome.js';

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
}

const FREEZE = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}`;

const ORIGIN = 'http://faithful.localhost';
const ENTRY_DIR = '/__faithful__/';
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

export class Renderer {
  private constructor(private readonly browser: Browser) {}

  static async launch(): Promise<Renderer> {
    const errors: string[] = [];
    // Playwright's own build first, then any Chrome this machine already has.
    try {
      return new Renderer(await chromium.launch());
    } catch (e) {
      errors.push((e as Error).message.split('\n')[0] ?? String(e));
    }
    const exe = findChrome();
    if (exe) {
      try {
        return new Renderer(await chromium.launch({ executablePath: exe }));
      } catch (e) {
        errors.push(`${exe}: ${(e as Error).message.split('\n')[0]}`);
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
      await page.addStyleTag({ content: FREEZE }).catch(() => undefined);
      if (target.readyWhen) await page.waitForFunction(target.readyWhen, undefined, { timeout }).catch(() => undefined);
      await page.evaluate(() => document.fonts?.ready.then(() => undefined)).catch(() => undefined);
      // Two frames for layout that settles after fonts (a ResizeObserver, a measured header).
      await page.evaluate(
        () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );
      const raw: RawPage = await page.evaluate(extractPage, {
        ignore: opts.ignore ?? [],
        max: opts.maxElements ?? 4000,
      });
      if (opts.fonts !== false) await this.drawnFonts(page, raw);
      if (opts.screenshot)
        await page.screenshot({ path: opts.screenshot, fullPage: true, animations: 'disabled', caret: 'hide' });
      const screen: Rendered = toScreen(raw, viewport, screenId);
      if (target.probe) screen.probe = await page.evaluate(target.probe).catch((e: Error) => ({ error: e.message }));
      return screen;
    } finally {
      await ctx.close();
    }
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
      await page.route(`${ORIGIN}/**`, async (route) => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname);
        if (path === ENTRY) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
        // `./data.js` beside the page resolves under the entry's folder; `/assets/x.png` is
        // the site root's. Neither may leave its own directory.
        const rel = path.startsWith(ENTRY_DIR) ? path.slice(ENTRY_DIR.length) : null;
        const dir = rel !== null ? base : site;
        const file = dir ? resolve(dir, `.${rel !== null ? `/${rel}` : path}`) : undefined;
        if (!file || !inside(dir, file)) return route.fulfill({ status: 404, body: '' });
        try {
          return route.fulfill({ status: 200, contentType: mime(file), body: await readFile(file) });
        } catch {
          return route.fulfill({ status: 404, body: '' });
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
