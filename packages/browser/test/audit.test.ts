/**
 * The probe on real pages: every fault planted in fixtures/audit/slop.html is found, and the
 * clean page — a plain, deliberate page — gets nothing. The second half matters as much as the
 * first: a detector that fires on good design teaches an agent to ignore it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeViewports, scoreAudit, stressDelta } from '@faithful/core';
import { type Browser, chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Renderer } from '../src/index.js';
import { expandText } from '../src/stress.js';

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

  it('text cut off by its box is measured where it is seen, not on the page behind the hidden part', async () => {
    const { by } = await colours(
      '<div class="cut">white label far too long</div><div class="cut dim">grey label far too long</div>',
      '.cut{background:#123;color:#fff;width:60px;overflow:hidden;white-space:nowrap}.dim{color:#333}',
    );
    expect(by['white label far too long']).toEqual([255, 255, 255, '/', 17, 34, 51]);
    // A real fault in clipped text is still measured, against the right background.
    expect(by['grey label far too long']).toEqual([51, 51, 51, '/', 17, 34, 51]);
  });

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

describe('audit --stress: i18n and resilience passes', () => {
  const vp = { width: 375, height: 812 };
  const doc = (body: string, css = '', html = '<html lang="en">') =>
    `<!doctype html>${html}<head><title>t</title><style>body{margin:0;font:16px/1.5 Georgia;background:#fff;color:#111}main{padding:20px}${css}</style></head><body>${body}</body></html>`;
  /** What the stress pass adds over the normal one, as the CLI reports it. */
  const added = async (html: string, mode: 'expand' | 'rtl' | 'spacing') => {
    const normal = scoreAudit(await r.audit({ html }, vp), 'n');
    const stressed = scoreAudit(await r.audit({ html }, vp, { stress: mode }), `n ${mode}`);
    return { normal: normal.findings, added: stressDelta(normal, stressed, mode).findings };
  };

  it('expand: a fixed-width nowrap button that fits in English is cut off in translation', async () => {
    const html = doc(
      '<main><p>Your changes are kept for a week.</p><button class="save">Save draft</button></main>',
      '.save{width:96px;white-space:nowrap;overflow:hidden;padding:12px 0;background:#1d4ed8;color:#fff;border:0;font:16px Georgia}',
    );
    const { normal, added: a } = await added(html, 'expand');
    expect(normal).toEqual([]);
    expect(a.map((f) => `${f.kind} ${f.buildId}`)).toEqual(['clipped main>button.save']);
    expect(a[0]?.detail).toMatch(/^with text 1\.3–2× longer, as in translation: "Šàvé dràft/);
    // The same button sized to its text survives.
    const ok = await added(html.replace('width:96px;', ''), 'expand');
    expect(ok.added).toEqual([]);
  });

  it('expand: pseudo-localises visible prose only — figures, code, form values and hidden text are left', async () => {
    let browser: Browser | undefined;
    const own = await Renderer.launch(async (exe) => {
      browser = await chromium.launch(exe ? { executablePath: exe } : {});
      return browser;
    });
    try {
      const page = await (browser as Browser).newPage();
      await page.setContent(
        doc(
          '<main><p id="a">Save</p><p id="n">£1,250.00 – 12/05</p><code id="c">npm install</code><pre id="p">ls -la</pre><input id="i" value="Keep me"><textarea id="t">Draft text</textarea><p id="h" aria-hidden="true">Hidden aside</p><p id="d" style="display:none">Not shown</p><p id="l">This sentence is long enough to be expanded by only one third!</p></main><script>var s = "Script text";</script>',
        ),
      );
      const done = await page.evaluate(`(${expandText.toString()})()`);
      expect(done).toEqual({ applied: true, nodes: 2 });
      const read = (sel: string) =>
        page.$eval(sel, (e) => (e instanceof HTMLInputElement ? e.value : (e.textContent ?? '')));
      expect(await read('#a')).toBe('Šàvé ŀŏŕé');
      for (const [sel, same] of [
        ['#n', '£1,250.00 – 12/05'],
        ['#c', 'npm install'],
        ['#p', 'ls -la'],
        ['#i', 'Keep me'],
        ['#t', 'Draft text'],
        ['#h', 'Hidden aside'],
        ['#d', 'Not shown'],
      ])
        expect(await read(sel as string), sel).toBe(same);
      // Over 50 characters: 130%, give or take the last letter.
      const long = await read('#l');
      const want = Math.ceil('This sentence is long enough to be expanded by only one third!'.length * 1.3);
      expect(Math.abs(long.length - want)).toBeLessThanOrEqual(1);
      expect(long.startsWith('Thìš šéñtéñçé ìš löñg')).toBe(true);
    } finally {
      await own.close();
    }
  });

  it('rtl: a menu opened with a physical left offset spills off the page only in right-to-left', async () => {
    const html = doc(
      '<header><a href="/">Home</a><div class="acct"><a href="/me">Account</a><ul class="menu"><li><a href="/settings">Settings</a></li></ul></div></header><main><p>Welcome back.</p></main>',
      'header{display:flex;justify-content:space-between;padding:12px 16px}.acct{position:relative}.menu{position:absolute;top:100%;left:-200px;width:240px;margin:0;padding:8px;list-style:none;background:#f4f4f4}',
    );
    const { normal, added: a } = await added(html, 'rtl');
    expect(normal).toEqual([]);
    expect(a.map((f) => `${f.kind} ${f.buildId}`)).toEqual(['overflow header>div.acct>ul.menu']);
    expect(a[0]?.detail).toMatch(/^in right-to-left: the page scrolls sideways: \d+px wide in a 375px screen/);
    // Anchored logically (inset-inline-end), it opens inward in both directions.
    const fixed = await added(html.replace('left:-200px', 'inset-inline-end:0'), 'rtl');
    expect(fixed.added).toEqual([]);
  });

  it('a right-to-left page: text cut off at the LEFT edge of its box is clipped (it overflows that way)', async () => {
    const html = doc(
      '<main><button class="save">احفظ المسودة الآن</button></main>',
      '.save{width:60px;white-space:nowrap;overflow:hidden;padding:12px 0;background:#1d4ed8;color:#fff;border:0}',
      '<html lang="ar" dir="rtl">',
    );
    const f = scoreAudit(await r.audit({ html }, vp), 'a').findings.filter((x) => x.kind === 'clipped');
    expect(f.map((x) => x.detail)).toEqual([expect.stringMatching(/cut off by \d+px \(left edge of its box\)/)]);
  });

  it('spacing: a fixed-height box that fits its text clips it under WCAG 1.4.12 spacing, even against !important', async () => {
    const html = doc(
      '<main><div class="note">Bins go out on Tuesday night. Garden waste is collected every other week.</div></main>',
      '.note{height:40px;width:300px;overflow:hidden;font:16px/20px Georgia}',
    );
    const { normal, added: a } = await added(html, 'spacing');
    expect(normal).toEqual([]);
    expect(a.map((f) => `${f.kind} ${f.buildId}`)).toEqual(['clipped main>div.note']);
    expect(a[0]?.detail).toMatch(/^with WCAG 1\.4\.12 text spacing: "Bins go out/);
    // A user stylesheet beats the author's !important, so the pass must too.
    const loud = await added(
      html.replace('</style>', '.note,body{line-height:20px!important;letter-spacing:0!important}</style>'),
      'spacing',
    );
    expect(loud.added.map((f) => f.kind)).toEqual(['clipped']);
    // min-height instead of height: the box grows and nothing is lost.
    expect((await added(html.replace('height:40px', 'min-height:40px'), 'spacing')).added).toEqual([]);
  });

  it('a pass the page refuses is an error from the renderer, never a clean reading', async () => {
    const html = doc('<main><p>Left to right, always.</p></main>', 'body{direction:ltr!important}');
    await expect(r.audit({ html }, vp, { stress: 'rtl' })).rejects.toThrow(/rtl pass could not be applied/);
  });

  it('the clean page adds nothing under any pass, at either width', async () => {
    const html = readFileSync(resolve(FIX, 'clean.html'), 'utf8');
    for (const width of [375, 1440])
      for (const mode of ['expand', 'rtl', 'spacing'] as const) {
        const v = { width, height: 900 };
        const normal = scoreAudit(await r.audit({ html, baseDir: FIX }, v), 'n');
        const stressed = scoreAudit(await r.audit({ html, baseDir: FIX }, v, { stress: mode }), 'n');
        expect(stressDelta(normal, stressed, mode).findings, `${mode}@${width}`).toEqual([]);
      }
  });
});
