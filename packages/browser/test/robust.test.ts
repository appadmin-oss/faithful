/**
 * A page must not be able to crash, hang or fool the renderer: a malformed URL, a script stuck
 * in a loop, a page that rewrites the DOM APIs the probe measures with. And a stale browser
 * override must not stop a working browser from starting.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scoreAudit } from '@faithful/core';
import type { Browser } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BrowserError, launchPlan, Renderer } from '../src/index.js';

let r: Renderer;
beforeAll(async () => {
  r = await Renderer.launch();
}, 60_000);
afterAll(async () => r?.close());

const vp = { width: 800, height: 600 };
const page = (body: string, head = '') =>
  `<!doctype html><html><head><title>t</title>${head}</head><body><main><h1>Hi</h1>${body}</main></body></html>`;

describe('the renderer survives the page', () => {
  it('a URL that is not valid percent-encoding is a 404, not a crash', async () => {
    const f = await r.audit(
      { html: page('<img src="./100%.png" alt="x"><p>text</p><script>fetch("/%").catch(()=>{})</script>') },
      vp,
      { timeoutMs: 10_000 },
    );
    expect(f.brokenImages.map((b) => b.src)).toEqual(['./100%.png']);
    expect(f.runtime?.failed.filter((x) => x.status === 404).map((x) => x.url)).toEqual([
      'http://faithful.localhost/__faithful__/100%.png',
      'http://faithful.localhost/%',
    ]);
  }, 30_000);

  it('a file whose name is literally "100%.png" is still served', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'faithful-pct-'));
    // A 1×1 GIF.
    writeFileSync(
      join(dir, '100%.png'),
      Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
    );
    const f = await r.audit({ html: page('<img src="./100%.png" alt="x">'), baseDir: dir }, vp, { timeoutMs: 10_000 });
    expect(f.brokenImages).toEqual([]);
  }, 30_000);

  it('a page stuck in a loop after load fails as a browser error within the timeout, and the renderer still works', async () => {
    const hang = page('<p>text</p><script>addEventListener("load",()=>setTimeout(()=>{for(;;){}},50))</script>');
    const t0 = Date.now();
    await expect(r.audit({ html: hang }, vp, { timeoutMs: 1500 })).rejects.toBeInstanceOf(BrowserError);
    await expect(r.capture({ html: hang }, vp, 's', { timeoutMs: 1500 })).rejects.toBeInstanceOf(BrowserError);
    expect(Date.now() - t0).toBeLessThan(25_000);
    const ok = await r.audit({ html: page('<p>fine</p>') }, vp, { timeoutMs: 10_000 });
    expect(ok.headings.map((h) => h.text)).toEqual(['Hi']);
  }, 40_000);
});

describe('the probe cannot be fooled by the page', () => {
  it('overriding getComputedStyle, getBoundingClientRect and naturalWidth does not hide a broken image or a sideways scroll', async () => {
    const liar = `<script>
      Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { get: () => 100 });
      Element.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 10, 10);
      window.getComputedStyle = () => ({ display: 'none' });
    </script>`;
    const f = await r.audit(
      { html: page('<img src="./missing.png" alt="x"><div style="width:2000px;height:20px">wide</div>', liar) },
      vp,
      { timeoutMs: 10_000 },
    );
    expect(f.brokenImages.map((b) => b.src)).toEqual(['./missing.png']);
    const kinds = scoreAudit(f, 'a').findings.map((x) => x.kind);
    expect(kinds).toContain('broken');
    expect(kinds).toContain('overflow');
  }, 30_000);
});

describe('launching a browser', () => {
  const saved = { f: process.env.FAITHFUL_CHROMIUM, c: process.env.CHROME_PATH };
  afterEach(() => {
    for (const [k, v] of [
      ['FAITHFUL_CHROMIUM', saved.f],
      ['CHROME_PATH', saved.c],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const fake = { close: async () => undefined } as unknown as Browser;

  it('tries FAITHFUL_CHROMIUM first, even when Playwright has its own build', async () => {
    process.env.FAITHFUL_CHROMIUM = '/opt/my/chrome';
    delete process.env.CHROME_PATH;
    const tried: (string | undefined)[] = [];
    await Renderer.launch(async (exe) => {
      tried.push(exe);
      return fake;
    });
    expect(tried).toEqual(['/opt/my/chrome']);
    expect(launchPlan()[0]).toBe('/opt/my/chrome');
  });

  it('a stale override does not block the browsers behind it; when none starts, every attempt is named', async () => {
    process.env.FAITHFUL_CHROMIUM = '/gone/chrome';
    delete process.env.CHROME_PATH;
    const tried: (string | undefined)[] = [];
    await Renderer.launch(async (exe) => {
      tried.push(exe);
      if (exe === '/gone/chrome') throw new Error('Failed to launch: no such file');
      return fake;
    });
    expect(tried).toEqual(['/gone/chrome', undefined]);

    const all: (string | undefined)[] = [];
    const err = await Renderer.launch(async (exe) => {
      all.push(exe);
      throw new Error(`cannot start ${exe ?? 'bundled'}`);
    }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(BrowserError);
    expect(all).toEqual(launchPlan());
    expect((err as Error).message).toContain('/gone/chrome: cannot start /gone/chrome');
    expect((err as Error).message).toContain("Playwright's Chromium: cannot start bundled");
  });
});
