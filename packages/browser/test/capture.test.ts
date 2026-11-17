import { compareScreens, DEFAULT_CONFIG } from '@faithful/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Renderer } from '../src/index.js';

let r: Renderer;
beforeAll(async () => {
  r = await Renderer.launch();
}, 60_000);
afterAll(async () => {
  await r?.close();
});

const vp = { width: 800, height: 600 };
const page = (body: string, css = '') =>
  `<!doctype html><html><head><style>body{margin:0;font:16px/24px sans-serif;color:#10292c}${css}</style></head><body>${body}</body></html>`;

describe('capture', () => {
  it('reads text as blocks, with the box of the glyphs', async () => {
    const s = await r.capture(
      { html: page('<h1 style="margin:0;font-size:32px;line-height:40px">Save <b>now</b></h1><p>Second</p>') },
      vp,
      's',
    );
    const texts = s.elements.filter((e) => e.kind === 'text');
    expect(texts.map((t) => t.text)).toEqual(['Save now', 'Second']);
    const h = texts[0];
    expect(h?.box?.w).toBeLessThan(400); // the words, not the 800px block
    expect(h?.style?.fontSize).toBe(32);
    expect(h?.style?.fontWeight).toBe(700);
    expect(h?.style?.lineHeight).toBe(40);
  });

  it('reads a control once, by its label, and marks it interactive', async () => {
    const s = await r.capture(
      {
        html: page(
          '<button style="padding:12px 20px;border:0;background:#237b22;color:#fff;border-radius:999px">Vote <span>now</span></button><a href="#x" aria-label="Close"><svg width="16" height="16"></svg></a>',
        ),
      },
      vp,
      's',
    );
    const c = s.elements.filter((e) => e.kind === 'control');
    expect(c.map((x) => x.text)).toEqual(['Vote now', 'Close']);
    expect(c.every((x) => x.interactive)).toBe(true);
    expect(c[0]?.style?.background).toBe('rgb(35, 123, 34)');
    expect(s.elements.filter((e) => e.kind === 'text')).toEqual([]);
  });

  it('reads painted surfaces as boxes and skips invisible things', async () => {
    const s = await r.capture(
      {
        html: page(
          '<div class="card" style="width:200px;height:100px;background:#fff;border:1px solid #ddd;border-radius:12px"></div><div style="opacity:0"><p>ghost</p></div><p hidden>hidden</p><div style="visibility:hidden">vis</div>',
        ),
      },
      vp,
      's',
    );
    const box = s.elements.find((e) => e.kind === 'box');
    expect(box?.style).toMatchObject({ background: 'rgb(255, 255, 255)', borderWidth: 1, radius: 12 });
    expect(s.elements.some((e) => e.text === 'ghost' || e.text === 'hidden' || e.text === 'vis')).toBe(false);
  });

  it('names elements by a short CSS path that finds exactly one element', async () => {
    const s = await r.capture(
      { html: page('<ul class="list"><li>One</li><li>Two</li></ul><p id="lede">Lede</p>') },
      vp,
      's',
    );
    const ids = s.elements.map((e) => e.id);
    expect(ids).toContain('#lede');
    expect(ids.some((i) => i.includes('li:nth-of-type(2)'))).toBe(true);
  });

  it('reports a design font that did not load as the face actually drawn', async () => {
    const html = page(
      '<p style="font-family:\'Faithful Missing Face\', serif">Fallback</p>',
      "@font-face{font-family:'Faithful Missing Face';src:url(data:font/woff2;base64,AAAA) format('woff2')}",
    );
    const s = await r.capture({ html }, vp, 's');
    const p = s.elements.find((e) => e.text === 'Fallback');
    expect(p?.style?.renderedFont).toBeDefined();
    expect(p?.style?.renderedFont?.toLowerCase()).not.toContain('faithful missing face');
    const res = compareScreens(s, s, DEFAULT_CONFIG);
    expect(res.findings.some((f) => f.kind === 'font-family' && f.detail.includes('did not load'))).toBe(true);
  });

  it('a page compared with itself passes with 100', async () => {
    const html = page(
      '<header style="height:64px;background:#fbfbfa"><h1 style="margin:0">Title</h1></header><main><p>Body copy</p><button>Go</button></main>',
      'button{min-height:44px}',
    );
    const a = await r.capture({ html }, vp, 'a');
    const b = await r.capture({ html }, vp, 'b');
    const res = compareScreens(a, b, DEFAULT_CONFIG);
    expect(res.findings.filter((f) => f.kind !== 'target')).toEqual([]);
    expect(res.score).toBe(100);
  });

  it('finds a changed colour, a moved button and changed copy between two real renders', async () => {
    const d = page(
      '<h1 style="margin:16px;color:#10292c">Pick your plan</h1><p style="margin:16px">Cancel any time</p><button style="margin:16px;padding:12px 24px">Start trial</button>',
    );
    const b = page(
      '<h1 style="margin:16px;color:#2f6f3a">Pick your plan</h1><p style="margin:16px">Cancel anytime</p><button style="margin:16px 16px 16px 120px;padding:12px 24px">Start trial</button>',
    );
    const res = compareScreens(
      await r.capture({ html: d }, vp, 'd'),
      await r.capture({ html: b }, vp, 'b'),
      DEFAULT_CONFIG,
    );
    const kinds = res.findings.map((f) => f.kind).sort();
    expect(kinds).toEqual(['color', 'position', 'text']);
  });
});
