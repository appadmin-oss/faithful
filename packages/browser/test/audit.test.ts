/**
 * The probe on real pages: every fault planted in fixtures/audit/slop.html is found, and the
 * clean page — a plain, deliberate page — gets nothing. The second half matters as much as the
 * first: a detector that fires on good design teaches an agent to ignore it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeViewports, scoreAudit, stressDelta } from '@usefaithful/core';
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
    results.push(scoreAudit(await r.audit({ html, baseDir: FIX }, vp, { axe: true }), `audit@${vp.width}`));
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
    // axe-core: the unlabelled coupon field, once. axe also fails the planted contrast and the
    // tiny targets, but Faithful reports those itself: never a second finding for them.
    expect(f.filter((x) => x.kind === 'a11y').map((x) => `${x.severity} ${x.detail} [${x.buildId}]`)).toEqual([
      'error label: Form elements must have labels [input[name="coupon"]]',
    ]);
    expect(f.filter((x) => x.kind === 'target')).toHaveLength(2);
    expect(f.filter((x) => x.kind === 'unmeasured')).toEqual([]);
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

  it("finds a menu's logic faults on a real page (MAM Academy's portal, Nov 2026)", async () => {
    const f = await run('nav.html');
    const nav = f.filter((x) => x.kind === 'navigation').map((x) => x.detail);
    expect(nav.some((d) => /2 names \("Grade entry", "Marking"\)/.test(d))).toBe(true);
    expect(nav.some((d) => /the "More" menu lists 8 entries in one strip \(more than 7\)/.test(d))).toBe(true);
    expect(f.some((x) => x.kind === 'heading' && /no h1: its title "Marking" is an h2/.test(x.detail))).toBe(true);
    // Once each, not once per viewport.
    expect(nav.filter((d) => /2 names/.test(d))).toHaveLength(1);
  }, 90_000);

  it('the clean page has nothing to report but the system it keeps to', async () => {
    const f = await run('clean.html');
    expect(f.filter((x) => !/^the page's system: /.test(x.detail))).toEqual([]);
    expect(f.map((x) => x.detail)).toContainEqual(expect.stringMatching(/^the page's system: .*spacing on a 4px grid/));
  }, 90_000);
});

describe('axe-core inside audit', () => {
  const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
  // Four faults only axe sees: a field with no label, an image with no alt, a button with no
  // name (big enough that Faithful's own target check has nothing to say), no html lang.
  const FAULTY = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plots</title><style>body{font:17px/1.5 Georgia;margin:20px;color:#111;background:#fff}button{width:44px;height:44px}</style></head><body><main><h1>Twelve plots free</h1><p>Apply before May.</p><img src="${GIF}" width="40" height="40"><form><input name="plot"><button></button></form></main></body></html>`;
  const vps = [
    { width: 375, height: 812 },
    { width: 1440, height: 900 },
  ];
  const audited = async (html: string, opts: Parameters<Renderer['audit']>[2] = { axe: true }) => {
    const results = [];
    for (const vp of vps) results.push(scoreAudit(await r.audit({ html }, vp, opts), `audit@${vp.width}`));
    mergeViewports(results);
    return results.flatMap((x) => x.findings);
  };

  it('a missing label, alt, button name and html lang: each reported once, nothing else', async () => {
    const f = await audited(FAULTY);
    expect(f.map((x) => `${x.severity} ${x.kind} ${x.detail.split(':')[0]} ${x.viewport}`).sort()).toEqual([
      'error a11y button-name 375x812,1440x900',
      'error a11y html-has-lang 375x812,1440x900',
      'error a11y image-alt 375x812,1440x900',
      'error a11y label 375x812,1440x900',
    ]);
    expect(f.find((x) => x.detail.startsWith('image-alt'))?.help).toBe(
      'https://dequeuniversity.com/rules/axe/4.14/image-alt',
    );
  }, 90_000);

  it('runs in its own world: a page that plants a fake, locked window.axe cannot hide a fault', async () => {
    // A locked, fake `axe` that always answers clean: in the page's own world it would win.
    const fake =
      '<script>Object.defineProperty(window,"axe",{value:{run:()=>Promise.resolve({violations:[],incomplete:[]})},writable:false,configurable:false})</script>';
    const f = await audited(FAULTY.replace('<title>', `${fake}<title>`));
    expect(f.filter((x) => x.kind === 'a11y')).toHaveLength(4);
  }, 90_000);

  it('what axe cannot decide is one note, never a pass and never a fault', async () => {
    const f = await audited(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>t</title></head><body><main><p aria-describedby="nowhere">Plots</p><video controls width="200" height="100"></video></main></body></html>',
    );
    expect(f.map((x) => `${x.severity} ${x.kind}`)).toEqual(['info a11y']);
    expect(f[0]?.detail).toBe(
      'needs review: axe-core could not decide 2 elements (aria-valid-attr-value ×1, video-caption ×1): check by hand',
    );
  }, 90_000);

  it('switched off it reports nothing; failing to run it is an unmeasured warning, never a clean page', async () => {
    expect(await audited(FAULTY, {})).toEqual([]);
    expect(await audited(FAULTY, { axe: false })).toEqual([]);
    const broken = await audited(FAULTY, { axe: true, axeScript: 'throw new Error("blocked by policy")' });
    expect(broken.map((x) => `${x.severity} ${x.kind} ${x.viewport}`)).toEqual(['warn unmeasured 375x812,1440x900']);
    expect(broken[0]?.detail).toMatch(/^axe-core did not run \(.*blocked by policy.*\): the WCAG rules/);
    // A build that loads but defines no axe is the same.
    const empty = await audited(FAULTY, { axe: true, axeScript: '/* nothing */' });
    expect(empty[0]?.detail).toMatch(/axe-core did not load/);
  }, 90_000);

  it('a stress pass never runs axe: it reports layout faults only', async () => {
    const facts = await r.audit({ html: FAULTY }, { width: 375, height: 812 }, { axe: true, stress: 'rtl' });
    expect(facts.axe).toBeUndefined();
  }, 90_000);
});

describe('audit probe: contrast as drawn (WCAG 1.4.3)', () => {
  const vp = { width: 1024, height: 768 };
  const page = (body: string, css = '') =>
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>t</title><style>body{font:16px/1.5 Georgia;margin:20px;background:#fff;color:#000}${css}</style></head><body><main>${body}</main></body></html>`;
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
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>t</title><style>body{font:16px/1.5 Georgia;margin:20px}${css}</style></head><body><main><h1>Title</h1>${body}</main></body></html>`;
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
    `<!doctype html>${html}<head><meta name="viewport" content="width=device-width,initial-scale=1"><title>t</title><style>body{margin:0;font:16px/1.5 Georgia;background:#fff;color:#111}main{padding:20px}${css}</style></head><body>${body}</body></html>`;
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

describe('enlarged text and 320px reflow (MAM Academy, Nov 2026)', () => {
  // A desktop bar sized for its words at the author's text size: one row, no room to spare,
  // its overflow hidden. At 200% text the last entry is cut off; at the author's size it is not.
  const BAR = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Academy</title><style>body{font:16px/1.5 Georgia;margin:0;color:#111;background:#fff}
nav{height:48px;overflow:hidden;white-space:nowrap}nav a{display:inline-block;padding:12px 10px;color:#123}main{padding:16px}</style></head>
<body><nav aria-label="Main"><a href="/a">Programmes</a><a href="/b">About us</a><a href="/c">Life at MAM</a><a href="/d">Auditer</a><a href="/apply">Apply now</a></nav>
<main><h1>Academy</h1><p>Short and plain.</p></main></body></html>`;
  // 340px of fixed width: fine at 375, a sideways scroll at 320.
  const WIDE = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Academy</title><style>body{font:16px/1.5 Georgia;margin:0;color:#111;background:#fff}.card{width:340px;margin:0 auto}</style></head>
<body><main><h1>Academy</h1><div class="card"><p>Short and plain.</p></div></main></body></html>`;
  const pass = async (html: string, vp: { width: number; height: number }, stress: 'zoom' | 'reflow') => {
    const normal = scoreAudit(await r.audit({ html, baseDir: FIX }, vp, {}), 's');
    const stressed = scoreAudit(await r.audit({ html, baseDir: FIX }, vp, { stress }), 's');
    return { normal, delta: stressDelta(normal, stressed, stress) };
  };

  it('a bar that fits at the author’s size loses its last entry at 200% text, and only that pass says so', async () => {
    const { normal, delta } = await pass(BAR, { width: 1440, height: 900 }, 'zoom');
    expect(normal.findings.filter((x) => x.kind === 'clipped')).toEqual([]);
    // Reported, but as a warning: text enlarged alone (Android font scale, iOS text size) breaks
    // it, which WCAG 1.4.4 itself does not require when page zoom works.
    const hit = delta.findings.find((x) => x.kind === 'clipped' && /text alone at 200%/.test(x.detail));
    expect(hit?.severity).toBe('warn');
  }, 90_000);

  it('a page that fits 375 but not 320 scrolls sideways only in the reflow pass', async () => {
    const { normal, delta } = await pass(WIDE, { width: 375, height: 812 }, 'reflow');
    expect(normal.findings.filter((x) => x.kind === 'overflow')).toEqual([]);
    expect(delta.findings.map((x) => `${x.severity}:${x.kind}`)).toContain('error:overflow');
    expect(delta.findings.find((x) => x.kind === 'overflow')?.detail).toMatch(/at 320px wide/);
  }, 90_000);

  it('the clean page survives both', async () => {
    const html = readFileSync(resolve(FIX, 'clean.html'), 'utf8');
    for (const [vp, s] of [
      [{ width: 1440, height: 900 }, 'zoom'],
      [{ width: 375, height: 812 }, 'reflow'],
    ] as const)
      expect((await pass(html, vp, s)).delta.findings, s).toEqual([]);
  }, 120_000);
});

describe('tells, measured with restraint (after MengTo)', () => {
  const page = (body: string) =>
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>t</title><style>body{font:16px/1.5 Georgia;margin:20px;color:#111;background:#fff}
.card{border-radius:8px;padding:16px;width:200px;height:80px;background:#f6f6f6}.stripe{border-left:4px solid #2563eb}
.hero{width:400px;height:160px;border-radius:16px;background:linear-gradient(135deg,#7c3aed,#2563eb);box-shadow:0 0 40px rgba(124,58,237,.6);border:1px solid rgba(37,99,235,.8)}
.eyebrow{font-size:12px}</style></head><body><main>${body}</main></body></html>`;
  const slop = async (body: string) =>
    (await r.audit({ html: page(body), baseDir: FIX }, { width: 1440, height: 900 }, {})).slop;

  it('a stripe down a row of three cards is a tell; one callout with a coloured edge is not', async () => {
    const row = await slop(
      '<h1>Plans</h1><div><div class="card stripe">A</div><div class="card stripe">B</div><div class="card stripe">C</div></div>',
    );
    expect(row.sideStripes).toHaveLength(3);
    const one = await slop(
      '<h1>Plans</h1><div><div class="card stripe">Note: bins go out on Tuesday.</div><div class="card">B</div></div>',
    );
    expect(one.sideStripes).toEqual([]);
  }, 60_000);

  it('three decorative layers on one box are stacked; one gradient alone is not', async () => {
    expect(await slop('<h1>Plans</h1><div class="hero">Start</div>').then((x) => x.stacked)).toHaveLength(1);
    expect(
      await slop(
        '<h1>Plans</h1><div style="width:400px;height:160px;background:linear-gradient(#fff,#eee)">Start</div>',
      ).then((x) => x.stacked),
    ).toEqual([]);
  }, 60_000);

  it('a label that only repeats its heading is restated; one that adds something is not', async () => {
    expect(await slop('<p class="eyebrow">Features</p><h2>Our features</h2>').then((x) => x.restated)).toHaveLength(1);
    expect(await slop('<p class="eyebrow">New in 2.0</p><h2>Our features</h2>').then((x) => x.restated)).toEqual([]);
    // Sharing a word is not repeating: "teams" says something the heading does not.
    expect(
      await slop('<p class="eyebrow">Features for teams</p><h2>Our features</h2>').then((x) => x.restated),
    ).toEqual([]);
  }, 60_000);
});

describe('dead links and the document title, measured', () => {
  it('#, javascript: and a #id with no such id are dead; a skip link to a real id is not', async () => {
    const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plots · Hackney Growers</title></head><body>
<a href="#main">Skip to content</a><a href="#">Read more</a><a href="javascript:void(0)">Open</a><a href="#faq">FAQ</a><a href="/apply">Apply</a>
<main id="main"><h1>Plots</h1></main></body></html>`;
    const f = await r.audit({ html, baseDir: FIX }, { width: 1440, height: 900 }, {});
    expect(f.deadLinks?.map((d) => d.href)).toEqual(['#', 'javascript:void(0)', '#faq']);
    expect(f.doc).toEqual({ title: 'Plots · Hackney Growers', description: '', viewportMeta: true });
  }, 60_000);
});

describe('consistency, measured on a real page', () => {
  it("one button a hair off the brand blue and shaped unlike the rest is reported; the page's own system is not", async () => {
    const btn = (bg: string, r: number, t: string) =>
      `<a href="/${t}" style="display:inline-block;padding:12px 20px;margin:4px;border-radius:${r}px;background:${bg};color:#fff">${t}</a>`;
    const body =
      ['Plots', 'Rules', 'Fees', 'Join', 'Help'].map((t) => btn('#2563eb', 10, t)).join('') +
      btn('#2765ea', 4, 'Donate');
    const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Growers</title><style>body{font:16px/1.5 Georgia;margin:20px;color:#111;background:#fff}</style></head><body><main><h1>Growers</h1><p>${body}</p></main></body></html>`;
    const f = scoreAudit(await r.audit({ html, baseDir: FIX }, { width: 1440, height: 900 }, {}), 's').findings.filter(
      (x) => x.kind === 'consistency',
    );
    expect(f.map((x) => x.detail)).toEqual([
      expect.stringMatching(/^colour #2765ea \(×1\) is a near-copy of #2563eb \(×5\)/),
      '1 of 6 buttons are shaped differently (4px corners, the rest 10px), e.g. "Donate"',
    ]);
  }, 60_000);
});

describe('motion the reader asked to be spared (prefers-reduced-motion)', () => {
  const page = (css: string) =>
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>News</title><style>body{font:16px/1.5 Georgia;margin:20px;color:#111;background:#fff}
@keyframes slide{from{transform:translateX(0)}to{transform:translateX(-50%)}}@keyframes fade{from{opacity:0}to{opacity:1}}${css}</style></head>
<body><main><h1>News</h1><div class="ticker">Open day on Saturday · New term starts in January</div></main></body></html>`;
  const motion = async (css: string) =>
    scoreAudit(await r.audit({ html: page(css), baseDir: FIX }, { width: 1440, height: 900 }, {}), 's').findings.filter(
      (x) => x.kind === 'motion',
    );

  it('an endless sliding ticker that ignores the setting is reported; the same ticker switched off is not; a fade is not', async () => {
    const loose = await motion('.ticker{animation:slide 12s linear infinite}');
    expect(loose.map((x) => x.detail)).toEqual([
      expect.stringMatching(
        /^1 element still moves when the reader has asked for less motion \(prefers-reduced-motion\): main>div\.ticker \(slide 12000ms, forever\)$/,
      ),
    ]);
    expect(
      await motion(
        '.ticker{animation:slide 12s linear infinite}@media (prefers-reduced-motion: reduce){.ticker{animation:none}}',
      ),
    ).toEqual([]);
    expect(await motion('.ticker{animation:fade .4s ease-out}')).toEqual([]);
  }, 60_000);
});

describe('copy that narrates the interface', () => {
  const css = `<style>body{font:16px/1.5 Georgia;margin:20px;color:#111;background:#fff}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card{padding:16px;border:1px solid #ccc;border-radius:8px;background:#fafafa}</style>`;
  const head = (t: string) =>
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t}</title>${css}</head>`;
  const wording = async (html: string) =>
    scoreAudit(await r.audit({ html, baseDir: FIX }, { width: 1440, height: 900 }, {}), 's').findings.filter(
      (x) => x.kind === 'wording' || x.kind === 'slop',
    );

  it('a dashboard that explains itself everywhere is named, as a pattern and as a tell', async () => {
    const f = await wording(`${head('Money')}<body><main>
<h1>Your money</h1><p>This page shows an overview of all your accounts and spending.</p>
<section><h2>Recent activity</h2><p>Your recent account activity.</p><p>£12.40 Tesco, 3 March</p></section>
<section><h2>Monthly spending</h2><p>See your monthly spending at a glance.</p><p>£1,204 so far</p></section>
<div class="grid">
<div class="card"><h3>Accounts</h3><p>Easily manage all of your connected bank accounts in one simple place.</p></div>
<div class="card"><h3>Budgets</h3><p>Easily plan the money you want to spend each month by category.</p></div>
<div class="card"><h3>Goals</h3><p>Easily save towards the things that matter most to you and yours.</p></div></div>
<p>Every figure here is derived from the ledger.</p></main>
<footer><p>All amounts are calculated in real time from your linked accounts.</p></footer></body></html>`);
    const said = f.map((x) => `${x.severity} ${x.detail}`);
    expect(said).toContainEqual(
      expect.stringMatching(
        /^warn 3 of \d+ headings are explained by the sentence under them, e\.g\. "This page shows/,
      ),
    );
    expect(said).toContainEqual(expect.stringMatching(/^warn 3 cards in one grid open the same way \("Easily…"\)/));
    expect(said).toContainEqual(expect.stringMatching(/^warn 2 notes vouch for the page instead of informing/));
    expect(said).toContainEqual(
      expect.stringMatching(
        /reads as generated: \d+ known tells together \(.*headings explained by the sentence under them/,
      ),
    );
  }, 60_000);

  it('a service page that says something under each heading is left alone', async () => {
    const f = await wording(`${head('Renew a passport')}<body><main>
<h1>Renew or replace your adult passport</h1><p>It costs £88.50 to renew online, or £100 by post.</p>
<h2>Before you start</h2><p>You'll need your old passport and a digital photo.</p>
<h2>Check your answers</h2><p>Check your answers before sending your application.</p>
<form><label for="dob">Date of birth</label><p id="dob-hint">For example, 27 3 2007</p><input id="dob" aria-describedby="dob-hint"></form>
<details open><summary>Help with photos</summary><h3>Photos</h3><p>This section explains how to take a photo.</p></details>
<h2>Your reference</h2><p id="ref-hint">Use this page to find your reference number.</p><input aria-label="Reference" aria-describedby="ref-hint">
<h2>Contact</h2><p>Phone 0300 222 0000, Monday to Friday, 8am to 8pm.</p></main>
<footer><p>All content is available under the Open Government Licence. © Crown copyright</p></footer></body></html>`);
    expect(f.filter((x) => /explained by|open the same way|vouch|explain themselves/.test(x.detail))).toEqual([]);
  }, 60_000);
});

describe('a layout fault judged by what it is', () => {
  const page = (body: string, css = '') =>
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ctx</title><style>body{font:16px/1.5 Georgia;margin:20px;color:#111;background:#fff}${css}</style></head><body><main><h1>Context</h1>${body}</main></body></html>`;
  const audit = async (body: string, css = '') => {
    const res = scoreAudit(
      await r.audit({ html: page(body, css), baseDir: FIX }, { width: 1024, height: 800 }, { axe: false }),
      's',
    );
    mergeViewports([res]);
    return res.findings;
  };
  const said = (fs: { severity: string; kind: string; detail: string }[]) =>
    fs.map((f) => `${f.severity} ${f.kind} ${f.detail}`);
  const TWO = '<div class="pair"><p>Quarterly revenue report</p><p>Annual growth summary</p></div>';
  const PAIR = '.pair{position:relative;height:60px}.pair p{position:absolute;top:0;left:0;margin:0}';

  it('text drawn over text is an error; the same two under an opaque card are a stack, said as by design', async () => {
    expect(said(await audit(TWO, PAIR))).toContainEqual(
      expect.stringMatching(/^error overlap "Quarterly revenue report" is drawn over/),
    );
    const stacked = said(await audit(TWO, `${PAIR}.pair p{background:#fff;padding:8px}`));
    expect(stacked.filter((x) => /^error overlap/.test(x))).toEqual([]);
    expect(stacked).toContainEqual('info overlap set aside as by design: 1 under an opaque card (a stack or deck)');
  }, 60_000);

  it('text in a picture of UI is not a layout error; that a screen reader and a keyboard reach it is', async () => {
    // A whole small app: a sidebar of rows, the two overlapping lines and a toolbar.
    const rows = Array.from({ length: 30 }, (_, i) => `<div class="row">Issue ${i}</div>`).join('');
    const pic = `<div class="mock"><nav>${rows}</nav>${TWO}<button>Ship</button><button>Merge</button></div>`;
    const out = said(
      await audit(
        pic,
        `${PAIR}.mock{transform:scale(.5);transform-origin:0 0}.mock button{width:12px;height:12px;padding:0;font-size:4px}`,
      ),
    );
    expect(out.filter((x) => /^error (overlap|clipped)|^warn target/.test(x))).toEqual([]);
    expect(out).toContainEqual(
      expect.stringMatching(
        /^warn a11y a picture of UI is exposed as UI \(a whole interface scaled to 50%\): \d+ texts cut off or drawn over each other in it .*; 2 controls in it that a keyboard tabs into/,
      ),
    );
    // Recall: the same two buttons at full size, as real UI, still fail their size.
    const real = said(
      await audit(
        '<button style="width:12px;height:12px;padding:0">x</button> <button style="width:12px;height:12px;padding:0">y</button>',
      ),
    );
    expect(real.filter((x) => /^warn target/.test(x)).length).toBeGreaterThan(0);
  }, 60_000);

  it('content hidden right now is a note to check later, not a fault now', async () => {
    const out = said(await audit(`<div style="opacity:0">${TWO}</div>`, PAIR));
    expect(out.filter((x) => /^error/.test(x))).toEqual([]);
    expect(out).toContainEqual(expect.stringMatching(/^info hidden 2 text blocks are invisible \(opacity 0\)/));
    // Clipped text in an inert panel (a closed drawer): checked when it opens.
    const drawer = said(
      await audit(
        '<div inert class="d"><p>Delivery and returns information</p></div>',
        '.d{width:80px;height:20px;overflow:hidden}',
      ),
    );
    expect(drawer.filter((x) => /^error/.test(x))).toEqual([]);
    expect(drawer).toContainEqual(
      expect.stringMatching(/^info clipped 1 text is cut off or overlapping in content hidden right now/),
    );
  }, 60_000);

  it('a marquee frozen with its words cut off is a note with the fix; a cut-off button label is an error, once ×3', async () => {
    const items = 'Ships weekly · Trusted by teams · Open source · '.repeat(2);
    const out = said(
      await audit(`<div class="mq"><span>${items}</span></div>`, '.mq{width:200px;overflow:hidden;white-space:nowrap}'),
    );
    expect(out).toContainEqual(expect.stringMatching(/^info clipped a marquee stands still with "Ships weekly/));
    expect(out.filter((x) => /^error clipped/.test(x))).toEqual([]);
    const slide = '<div class="s"><a class="b"><span>Read the whole story</span></a></div>';
    const three = said(await audit(slide.repeat(3), '.b{display:block;width:60px;overflow:hidden;white-space:nowrap}'));
    expect(three.filter((x) => /^error clipped/.test(x))).toEqual([
      expect.stringMatching(/^error clipped "Read the whole story" is cut off by \d+px \(right edge of its box\) ×3$/),
    ]);
  }, 60_000);

  it('a heading laid over a copy of itself, and a field over its floating label, are by design', async () => {
    const out = said(
      await audit(
        `<div class="hero"><h2 class="a">Financial infrastructure to grow</h2><h2 class="b">Financial infrastructure to grow</h2></div>
<div class="fl"><label for="em">Enter your email</label><input id="em"></div>`,
        '.hero{position:relative;height:80px}.hero h2{position:absolute;top:0;margin:0}.b{color:transparent;background:#fff}.fl{position:relative}.fl label{position:absolute;top:8px;left:8px}.fl input{position:relative;width:240px;height:40px;background:#fff}',
      ),
    );
    expect(out.filter((x) => /^(error|warn) overlap/.test(x))).toEqual([]);
    expect(out).toContainEqual(
      expect.stringMatching(/^info overlap set aside as by design: .*(layered|floating label)/),
    );
  }, 60_000);
});

describe('design sense: the page’s own system, and what misses it', () => {
  const page = (extra: string, css = '') =>
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sys</title><style>
body{font:16px/1.5 Georgia;margin:0;color:#111;background:#fff}main{padding:32px}h1{font-size:40px;margin:0 0 24px}h2{font-size:28px;margin:32px 0 16px}h3{font-size:20px;margin:24px 0 8px}
p{margin:0 0 16px}.card{padding:16px;margin:0 0 24px;border:1px solid #ccc}.row{display:flex;gap:8px;padding:8px 0}${css}</style></head><body><main>
<h1>Plans</h1><p>Choose a plan.</p><h2>Teams</h2><p>For teams of up to ten.</p><div class="card"><p>Ten seats.</p><p>Shared projects.</p></div>
<h2>Business</h2><p>For larger teams.</p><div class="card"><p>Fifty seats.</p><p>Single sign-on.</p></div><div class="row"><p>One</p><p>Two</p></div>
<h3>Support</h3><p>By email, every weekday.</p>${extra}</main></body></html>`;
  const designFindings = async (html: string) =>
    scoreAudit(await r.audit({ html, baseDir: FIX }, { width: 1024, height: 800 }, { axe: false }), 's')
      .findings.filter((x) => /edge \d+ elements share|drawn larger|off the \d+px grid|page's system/.test(x.detail))
      .map((x) => `${x.severity} ${x.kind} ${x.detail}`);

  it('a 2px slip, an h3 drawn larger than the h2 above it and one off-grid padding are named, with the values to use', async () => {
    const out = await designFindings(
      page(
        '<h3 class="big">Billing</h3><p class="slip">Invoices monthly.</p><div class="odd">Help</div>',
        '.big{font-size:34px}.slip{margin-left:2px}.odd{padding:13px}',
      ),
    );
    expect(out).toContainEqual(
      expect.stringMatching(
        /^warn consistency starts 2px right of the edge \d+ elements share \(x=32\): align it to that edge$/,
      ),
    );
    expect(out).toContainEqual(expect.stringMatching(/^warn heading h3 is drawn larger \(\d+px\) than h2 \(28px\)/));
    expect(out).toContainEqual(
      expect.stringMatching(/^info consistency 13px spacing \(×\d\) is off the 8px grid .*: use 12px or 16px$/),
    );
    expect(out).toContainEqual(expect.stringMatching(/^info consistency the page's system: .*spacing on a 8px grid/));
  }, 60_000);

  it('the same page without them says only what its system is', async () => {
    const out = await designFindings(page(''));
    expect(out.filter((x) => !/page's system/.test(x))).toEqual([]);
  }, 60_000);
});
