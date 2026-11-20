/**
 * The probe on real pages: every fault planted in fixtures/audit/slop.html is found, and the
 * clean page — a plain, deliberate page — gets nothing. The second half matters as much as the
 * first: a detector that fires on good design teaches an agent to ignore it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeViewports, scoreAudit } from '@faithful/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Renderer } from '../src/index.js';

const FIX = resolve(__dirname, '../../../fixtures/audit');
let r: Renderer;
beforeAll(async () => {
  r = await Renderer.launch();
}, 60_000);
afterAll(async () => r?.close());

async function run(file: string) {
  const html = readFileSync(resolve(FIX, file), 'utf8');
  const results = [];
  for (const vp of [
    { width: 375, height: 812 },
    { width: 1440, height: 900 },
  ]) {
    results.push(scoreAudit(await r.audit({ html, baseDir: FIX }, vp), `audit@${vp.width}`));
  }
  mergeViewports(results);
  return results.flatMap((x) => x.findings);
}

describe('audit probe', () => {
  it('finds every planted fault on the slop page, each once', async () => {
    const f = await run('slop.html');
    const has = (kind: string, re: RegExp) => f.some((x) => x.kind === kind && re.test(x.detail));
    expect(has('broken', /missing-photo\.png/)).toBe(true);
    expect(has('overflow', /scrolls sideways/)).toBe(true);
    expect(has('clipped', /far too much text/)).toBe(true);
    expect(has('overlap', /Monthly price.*Yearly price/)).toBe(true);
    expect(has('placeholder', /undefined/)).toBe(true);
    expect(has('placeholder', /Lorem ipsum/)).toBe(true);
    expect(has('placeholder', /John Doe/)).toBe(true);
    expect(has('hidden', /3 text blocks/)).toBe(true);
    expect(has('target', /close/)).toBe(true);
    for (const t of [
      'gradient text',
      'coloured glow',
      'emoji used as icons',
      'stripe down one side',
      'cards nested in cards',
      'frosted-glass',
      'pill badge above the headline',
      'any product',
    ]) {
      expect(has('slop', new RegExp(t)), t).toBe(true);
    }
    expect(has('wording', /named only "click here"/)).toBe(true);
    expect(has('wording', /"Submit"/)).toBe(true);
    expect(has('wording', /Sign in \/ Log in/)).toBe(true);
    // Contrast: the planted grey footnote, and the browser's default blue links on a near-black page.
    expect(has('contrast', /"Prices exclude VAT.*#4a4a5a on #0b0b12 is 2\.\d+:1 at 13px; needs 4\.5:1$/)).toBe(true);
    expect(has('contrast', /"click here" #0000ee on #0b0b12 .*\(×2 texts\)/)).toBe(true);
    // The gradient headline cannot be judged: a note, never a pass and never a fault.
    expect(f.filter((x) => x.kind === 'contrast').map((x) => x.severity)).toEqual(['error', 'error', 'info']);
    expect(f.find((x) => x.detail.startsWith('reads as generated'))?.severity).toBe('error');
    // Once per fault, not once per viewport.
    expect(f.filter((x) => x.kind === 'broken')).toHaveLength(1);
    expect(f.filter((x) => x.kind === 'runtime')).toHaveLength(0);
  }, 90_000);

  it('the clean page has nothing to report', async () => {
    expect(await run('clean.html')).toEqual([]);
  }, 90_000);
});

describe('audit probe: contrast as drawn (WCAG 1.4.3)', () => {
  const vp = { width: 1024, height: 768 };
  const page = (body: string, css = '') =>
    `<!doctype html><html lang="en"><head><title>t</title><style>body{font:16px/1.5 Georgia;margin:20px;background:#fff;color:#000}${css}</style></head><body><main>${body}</main></body></html>`;
  const colours = async (body: string, css = '', colorScheme: 'light' | 'dark' = 'light') => {
    const f = await r.audit({ html: page(body, css) }, vp, { colorScheme });
    const by = Object.fromEntries(
      (f.textColors ?? []).map((t) => [t.text, [...t.fg.map(Math.round), '/', ...t.bg.map(Math.round)]]),
    );
    return { f, by };
  };

  it('composites translucent backgrounds, colour alpha and every ancestor opacity', async () => {
    const { by } = await colours(
      '<div class="veil"><span>on a veil</span></div><p class="ghost">ghost text</p><div class="half"><p>half group</p></div>',
      '.veil{background:rgba(0,0,0,.5);color:#fff}.ghost{color:rgba(0,0,0,.4)}.half{opacity:.5;background:#000;color:#fff}',
    );
    expect(by['on a veil']).toEqual([255, 255, 255, '/', 128, 128, 128]);
    expect(by['ghost text']).toEqual([153, 153, 153, '/', 255, 255, 255]);
    // Opacity fades the text AND its background towards what is behind the group.
    expect(by['half group']).toEqual([255, 255, 255, '/', 128, 128, 128]);
  });

  it('text over an image, a gradient, a filter or a positioned picture is unknown, never measured', async () => {
    const { f, by } = await colours(
      '<div class="grad">on a gradient</div><div class="filt">filtered</div>' +
        '<div class="hero"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="><h2>over a photo</h2></div>' +
        '<p>plain words</p>',
      '.grad{background:linear-gradient(#000,#fff);color:#777}.filt{filter:invert(1)}' +
        '.hero{position:relative;height:200px}.hero img{position:absolute;inset:0;width:100%;height:100%}.hero h2{position:relative;color:#fff}',
    );
    expect(Object.keys(by)).toEqual(['plain words']);
    expect(f.contrastUnknown?.n).toBe(3);
    // Transparent text is not "1:1 on its own background": what shows (an SVG behind, a clip) is unknown.
    const g = await colours('<p class="clear">see-through words</p>', '.clear{color:transparent}');
    expect(g.by).toEqual({});
    expect(g.f.contrastUnknown?.why).toBe('transparent or clipped text');
  });

  it('disabled controls, aria-hidden text and logotypes are exempt; the same grey elsewhere is measured', async () => {
    const { f, by } = await colours(
      '<button disabled>Disabled</button><span aria-hidden="true">decor</span><a class="logo" href="/">Acme</a><p>pale words</p>',
      'button,span,a,p{color:#ccc}',
    );
    expect(Object.keys(by)).toEqual(['pale words']);
    expect(f.contrastUnknown?.n).toBe(0);
  });

  it('dark: a root that opts in draws on the dark canvas; the probe follows the scheme', async () => {
    const { by } = await colours(
      '<p>scheme text</p>',
      ':root{color-scheme:light dark}body{background:none;color:CanvasText}',
      'dark',
    );
    expect(by['scheme text']).toEqual([255, 255, 255, '/', 18, 18, 18]);
  });

  it('dark styles without color-scheme leave native controls light; setting color-scheme, or light mode, does not', async () => {
    const css = '@media (prefers-color-scheme: dark){body{background:#111;color:#eee}}';
    const body = '<form><label>Email <input name="e"></label></form>';
    expect((await colours(body, css, 'dark')).f.lightControls?.n).toBe(1);
    expect((await colours(body, `:root{color-scheme:light dark}${css}`, 'dark')).f.lightControls).toBeUndefined();
    expect((await colours(body, `form{color-scheme:dark}${css}`, 'dark')).f.lightControls).toBeUndefined();
    expect((await colours(body, css, 'light')).f.lightControls).toBeUndefined();
    // No dark styles at all: a white field on a dark page is a design choice, not a forgotten opt-in.
    expect((await colours(body, 'body{background:#111;color:#eee}', 'dark')).f.lightControls).toBeUndefined();
  });
});

describe('audit probe: edge cases measured as a person would', () => {
  const vp = { width: 1024, height: 768 };
  const doc = (body: string, css = '') =>
    `<!doctype html><html lang="en"><head><title>t</title><style>body{font:16px/1.5 Georgia;margin:20px}${css}</style></head><body><main><h1>Title</h1>${body}</main></body></html>`;
  const facts = (body: string, css = '') => r.audit({ html: doc(body, css) }, vp);

  it('a corner badge over the empty end of a full-width heading is no overlap; words on words still are', async () => {
    const f = await facts(
      '<div class="card"><h3>Basic</h3><span class="tag">Popular</span><p>For small teams.</p></div>' +
        '<div class="stack"><span>Monthly price</span><span>Yearly price</span></div>',
      '.card{position:relative;width:400px;padding:16px;border:1px solid #ccc}h3{margin:0}.tag{position:absolute;top:16px;right:16px;font-size:12px;background:#eee;padding:2px 6px}' +
        '.stack{position:relative;height:40px}.stack span{position:absolute;left:0;top:0}',
    );
    expect(f.overlaps.map((o) => `${o.text} / ${o.other}`)).toEqual(['Monthly price / Yearly price']);
  });

  it('a row of small links is not running text; a small link inside a sentence still is', async () => {
    const f = await facts(
      '<nav><a href="/a">Home</a><a href="/b">About</a><a href="/c">Pricing</a><a href="/d">Contact</a><a href="/e">Blog</a><a href="/f">Careers</a></nav>' +
        '<nav class="pages"><a href="?p=1">1</a> <a href="?p=2">2</a> <a href="?p=3">3</a></nav>' +
        '<p>Please read the <a class="s" href="/terms">terms</a> before you sign up for a plot this spring.</p>',
      'nav a,a.s{font-size:11px;line-height:1;margin-right:4px}',
    );
    expect(f.targets.map((t) => t.text)).toEqual([
      'Home',
      'About',
      'Pricing',
      'Contact',
      'Blog',
      'Careers',
      '1',
      '2',
      '3',
    ]);
    // The word links are spaced clear of each other (WCAG's spacing exception); the page numbers are not.
    const found = scoreAudit(f, 'a').findings.filter((x) => x.kind === 'target');
    expect(found.map((x) => x.detail.split(' is ')[0])).toEqual(['"1"', '"2"', '"3"']);
  });

  it('a target short in ONE dimension is flagged when crowded (WCAG 2.5.8); one spaced well clear passes', async () => {
    const f = await facts(
      '<div class="list"><a href="/1">First long link</a><a href="/2">Second long link</a></div>' +
        '<div style="margin-top:80px"><a class="lone" href="/3">Alone</a></div>',
      '.list a,.lone{display:block;width:200px;height:12px;font-size:10px;line-height:12px}',
    );
    const found = scoreAudit(f, 'a')
      .findings.filter((x) => x.kind === 'target')
      .map((x) => x.detail);
    expect(found).toEqual([
      '"First long link" is 200×12px; the minimum is 24×24',
      '"Second long link" is 200×12px; the minimum is 24×24',
    ]);
    expect(f.targets.find((t) => t.text === 'Alone')?.spaced).toBe(true);
  });

  it('© ® ™ ↔ ▶ are text, not emoji icons; a real emoji (or one asked for with U+FE0F) still is', async () => {
    const f = await facts(
      '<ul><li>© 2026 Acme Ltd</li><li><a href="/tm">™ Trademarks</a></li><li><a href="/r">® Registered</a></li><li><a href="/p">▶ Play</a></li><li><a href="/s">↔ Swap</a></li></ul>',
    );
    expect(f.slop.emojiIcons).toEqual([]);
    const g = await facts('<ul><li><a href="/go">🚀 Launch</a></li><li><a href="/v">▶️ Video</a></li></ul>');
    expect(g.slop.emojiIcons.map((e) => e.text)).toEqual(['🚀 Launch', '▶️ Video']);
  });

  it('colours in oklch() are read: a coloured glow and nested cards are seen as with rgb()', async () => {
    const f = await facts(
      '<div class="g">glow box</div><div class="c"><div class="c">nested card</div></div><div class="rg">rgb glow</div>',
      '.g{box-shadow:0 0 30px oklch(0.65 0.25 300 / 0.8);width:200px;height:80px;margin:40px}' +
        '.c{background:oklch(0.9 0.05 200);border-radius:12px;width:200px;height:100px;padding:10px}' +
        '.rg{box-shadow:0 0 30px rgba(168,85,247,0.8);width:200px;height:80px;margin:40px}',
    );
    expect(f.slop.glow).toHaveLength(2);
    expect(f.slop.nestedCards).toHaveLength(1);
    // A grey oklch shadow is no glow.
    const g = await facts(
      '<div class="g">soft</div>',
      '.g{box-shadow:0 0 30px oklch(0.5 0 0 / 0.8);width:200px;height:80px}',
    );
    expect(g.slop.glow).toEqual([]);
  });
});
