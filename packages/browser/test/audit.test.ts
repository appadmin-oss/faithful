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
    expect(f.find((x) => x.detail.startsWith('reads as generated'))?.severity).toBe('error');
    // Once per fault, not once per viewport.
    expect(f.filter((x) => x.kind === 'broken')).toHaveLength(1);
    expect(f.filter((x) => x.kind === 'runtime')).toHaveLength(0);
  }, 90_000);

  it('the clean page has nothing to report', async () => {
    expect(await run('clean.html')).toEqual([]);
  }, 90_000);
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
