import { describe, expect, it } from 'vitest';
import { compareScreens, sameFace } from '../src/compare.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { checkConformity } from '../src/inventory.js';
import { matchElements } from '../src/match.js';
import { box, screen, text } from './helpers.js';

const cfg = DEFAULT_CONFIG;
const page = () => [
  box('card', 100, 100, 600, 400),
  text('h', 'Choose your plan', 120, 120, 300, 32, { fontSize: 24, fontWeight: 700 }),
  text('p', 'Cancel any time. No fees.', 120, 170, 300, 24),
  text('cta', 'Start free trial', 120, 220, 160, 24),
  text('foot', 'Questions? Talk to us', 120, 440, 220, 24),
];

describe('compareScreens', () => {
  it('an identical build passes with 100', () => {
    const r = compareScreens(screen(page()), screen(page()), cfg);
    expect(r.findings).toEqual([]);
    expect(r.score).toBe(100);
  });

  it('a whole-page shift is ONE info finding, not a finding per element', () => {
    const shifted = page().map((e) => ({ ...e, box: e.box && { ...e.box, x: e.box.x + 30, y: e.box.y + 40 } }));
    const r = compareScreens(screen(page()), screen(shifted), cfg);
    expect(r.findings.map((f) => f.kind)).toEqual(['offset']);
    expect(r.findings[0]?.severity).toBe('info');
  });

  it('a cascade below a taller header blames the header, not everything under it', () => {
    const d = [
      box('head', 0, 0, 1280, 64),
      text('t', 'Brand', 16, 20, 80, 24),
      text('a', 'First paragraph of the page body', 16, 100, 400, 24),
      text('b', 'Second paragraph of the page body', 16, 140, 400, 24),
      text('c', 'Third paragraph of the page body', 16, 180, 400, 24),
      text('d2', 'Fourth paragraph of the page body', 16, 220, 400, 24),
    ];
    const b = d.map((e) =>
      e.id === 'head'
        ? { ...e, box: { x: 0, y: 0, w: 1280, h: 84 } }
        : e.box && e.box.y >= 100
          ? { ...e, box: { ...e.box, y: e.box.y + 20 } }
          : e,
    );
    const r = compareScreens(screen(d), screen(b), cfg);
    const kinds = r.findings.filter((f) => f.severity === 'error').map((f) => `${f.kind}:${f.id}`);
    expect(kinds).toContain('size:head');
    expect(kinds.filter((k) => k.startsWith('position'))).toEqual([]);
  });

  it('an element pushed down by an extra margin is reported, and the ones that follow it are not', () => {
    const d = [
      text('a', 'First paragraph of the page body', 16, 100, 400, 24),
      text('b', 'Second paragraph of the page body', 16, 140, 400, 24),
      text('c', 'Third paragraph of the page body', 16, 180, 400, 24),
      text('d2', 'Fourth paragraph of the page body', 16, 220, 400, 24),
    ];
    const b = d.map((e) => (e.box && e.box.y >= 140 ? { ...e, box: { ...e.box, y: e.box.y + 20 } } : e));
    const r = compareScreens(screen(d), screen(b), cfg);
    expect(r.findings.map((f) => `${f.kind}:${f.id}`)).toEqual(['position:b']);
  });

  it('a vertically centred stack: a shorter heading is ITS size finding, not the eyebrow above it moving', () => {
    // Hero column centred in a 600px band: eyebrow, heading, lede. The heading is 26px
    // shorter in the build, so the whole stack re-centres and the eyebrow drops 13px.
    const d = [
      text('nav', 'Northwind home', 16, 16, 200, 24),
      text('ey', 'Pricing · all plans', 132, 154, 172, 19),
      text('h1', 'Plans that grow with your team.', 132, 197, 494, 214, { fontSize: 68, lineHeight: 72 }),
      text('lede', 'Start free, then pay only for the seats you use.', 132, 435, 494, 48),
    ];
    const b = d.map((e) =>
      e.id === 'ey'
        ? { ...e, box: { x: 132, y: 167, w: 172, h: 19 } }
        : e.id === 'h1'
          ? { ...e, box: { x: 132, y: 210, w: 494, h: 188 } }
          : e.id === 'lede'
            ? { ...e, box: { x: 132, y: 422, w: 494, h: 48 } }
            : e,
    );
    const r = compareScreens(screen(d), screen(b), cfg);
    const kinds = r.findings.map((f) => `${f.kind}:${f.id}`);
    expect(kinds).toContain('size:h1');
    expect(kinds.filter((k) => k.startsWith('position'))).toEqual([]);
  });

  it('the same eyebrow moved by its own margin, with nothing below resizing, is still reported', () => {
    const d = [
      text('nav', 'Northwind home', 16, 16, 200, 24),
      text('ey', 'Pricing · all plans', 132, 154, 172, 19),
      text('h1', 'Plans that grow with your team.', 132, 197, 494, 214),
    ];
    const b = d.map((e) => (e.id === 'ey' ? { ...e, box: { x: 132, y: 167, w: 172, h: 19 } } : e));
    const r = compareScreens(screen(d), screen(b), cfg);
    expect(r.findings.map((f) => `${f.kind}:${f.id}`)).toEqual(['position:ey']);
  });

  it('an element placed alone, nowhere near where its neighbours put it, is reported', () => {
    const b = page().map((e) => (e.id === 'cta' ? { ...e, box: { x: 400, y: 220, w: 160, h: 24 } } : e));
    const r = compareScreens(screen(page()), screen(b), cfg);
    expect(r.findings.map((f) => `${f.kind}:${f.id}`)).toEqual(['position:cta']);
  });

  it('reports wrong copy exactly, and a near-miss is still an error', () => {
    const b = page().map((e) => (e.id === 'cta' ? { ...e, text: 'Start free trials' } : e));
    const r = compareScreens(screen(page()), screen(b), cfg);
    expect(r.findings.map((f) => f.kind)).toEqual(['text']);
    expect(r.findings[0]?.detail).toContain('Start free trials');
  });

  it('reports a style drift with the values on both sides', () => {
    const b = page().map((e) => (e.id === 'h' ? { ...e, style: { ...e.style, fontSize: 22, color: '#2a6f2a' } } : e));
    const r = compareScreens(screen(page()), screen(b), cfg);
    const k = r.findings.map((f) => f.kind).sort();
    expect(k).toEqual(['color', 'font-size']);
    expect(r.findings.find((f) => f.kind === 'font-size')?.detail).toBe('24px → 22px');
  });

  it('a colour within ΔE 1 passes and between 1 and 2.3 warns', () => {
    const near = page().map((e) => (e.id === 'p' ? { ...e, style: { ...e.style, color: '#10292d' } } : e));
    expect(compareScreens(screen(page()), screen(near), cfg).findings).toEqual([]);
    const off = page().map((e) => (e.id === 'p' ? { ...e, style: { ...e.style, color: '#142c30' } } : e));
    const f = compareScreens(screen(page()), screen(off), cfg).findings;
    expect(f.map((x) => `${x.kind}:${x.severity}`)).toEqual(['color:warn']);
  });

  it('missing and extra elements', () => {
    const b = page().filter((e) => e.id !== 'foot');
    b.push(text('x', 'Limited offer', 500, 600, 120, 24));
    const r = compareScreens(screen(page()), screen(b), cfg);
    expect(r.findings.map((f) => `${f.kind}:${f.severity}`).sort()).toEqual(['extra:warn', 'missing:error']);
    expect(r.score).toBeLessThan(100);
  });

  it('flags a touch target under the minimum', () => {
    const b = [
      ...page(),
      { id: 'icon', kind: 'control' as const, interactive: true, box: { x: 10, y: 10, w: 16, h: 16 } },
    ];
    const r = compareScreens(screen(page()), screen(b), cfg);
    expect(r.findings.some((f) => f.kind === 'target' && f.severity === 'error')).toBe(true);
  });

  it('font family compares the first family, unquoted and case-insensitive', () => {
    const b = page().map((e) =>
      e.kind === 'text' ? { ...e, style: { ...e.style, fontFamily: '"inter", system-ui' } } : e,
    );
    expect(compareScreens(screen(page()), screen(b), cfg).findings).toEqual([]);
    const c = page().map((e) => (e.id === 'p' ? { ...e, style: { ...e.style, fontFamily: 'Times New Roman' } } : e));
    expect(compareScreens(screen(page()), screen(c), cfg).findings.map((f) => f.detail)).toEqual([
      'inter → times new roman',
    ]);
  });
});

describe('matchElements', () => {
  it('pairs repeated labels by position, not first-come', () => {
    const d = [text('a', 'Edit', 100, 100, 40, 20), text('b', 'Edit', 100, 300, 40, 20)];
    const b = [text('B', 'Edit', 102, 302, 40, 20), text('A', 'Edit', 101, 101, 40, 20)];
    const m = matchElements(d, b, { width: 1280, height: 800 });
    expect(m.pairs.map((p) => `${p.d.id}-${p.b.id}`).sort()).toEqual(['a-A', 'b-B']);
  });
  it('recognises text split across elements and joined into one', () => {
    const d = [
      text('t', 'Vote for the people who build your community', 0, 0, 600, 40),
      text('x', 'Hello', 0, 100),
      text('y', 'World', 60, 100),
    ];
    const b = [
      text('1', 'Vote for the people', 0, 0, 300, 40),
      text('2', 'who build your community', 0, 40, 300, 40),
      text('z', 'Hello World', 0, 100),
    ];
    const m = matchElements(d, b, { width: 1280, height: 800 });
    expect(m.splits).toHaveLength(1);
    expect(m.splits[0]?.parts).toHaveLength(2);
    expect(m.merges).toHaveLength(1);
    expect(m.missing).toEqual([]);
    expect(m.extra).toEqual([]);
  });
  it('two stray copies of one word are not a split: each part must claim its own stretch, near the whole', () => {
    const d = [text('h', 'Your documents', 20, 20, 300, 32), text('cta', 'Save draft', 20, 100, 120, 24)];
    // Far across the page: not pieces of the button.
    const far = [
      text('h', 'Your documents', 20, 20, 300, 32),
      text('x1', 'draft', 900, 600, 50, 20),
      text('x2', 'draft', 20, 700, 50, 20),
    ];
    const m = matchElements(d, far, { width: 1280, height: 800 });
    expect(m.splits).toEqual([]);
    const r = compareScreens(screen(d), screen(far), DEFAULT_CONFIG);
    expect(r.findings.some((f) => f.severity === 'error' && f.id === 'cta')).toBe(true);
    expect(r.score).toBeLessThan(100);
    // Right beside it, but both are the same "draft": "save" is never covered.
    const close = [
      text('h', 'Your documents', 20, 20, 300, 32),
      text('x1', 'draft', 20, 100, 50, 24),
      text('x2', 'draft', 80, 100, 50, 24),
    ];
    expect(matchElements(d, close, { width: 1280, height: 800 }).splits).toEqual([]);
    // The real split of the same button still is one.
    const split = [
      text('h', 'Your documents', 20, 20, 300, 32),
      text('x1', 'Save', 20, 100, 40, 24),
      text('x2', 'draft', 64, 100, 50, 24),
    ];
    const s = matchElements(d, split, { width: 1280, height: 800 });
    expect(s.splits.map((x) => x.parts.map((p) => p.id))).toEqual([['x1', 'x2']]);
    expect(
      compareScreens(screen(d), screen(split), DEFAULT_CONFIG).findings.map((f) => `${f.severity}:${f.kind}`),
    ).toEqual(['warn:split']);
  });
  it('joined text needs its parts near it too', () => {
    const d = [text('a', 'Accept', 20, 100, 80, 24), text('b', 'cookies', 600, 500, 80, 24)];
    const b = [text('m', 'Accept cookies', 20, 100, 160, 24)];
    expect(matchElements(d, b, { width: 1280, height: 800 }).merges).toEqual([]);
    const together = [text('a', 'Accept', 20, 100, 80, 24), text('b', 'cookies', 104, 100, 80, 24)];
    expect(matchElements(together, b, { width: 1280, height: 800 }).merges).toHaveLength(1);
  });
  it('does not pair unrelated text however close it sits', () => {
    const m = matchElements([text('a', 'Checkout', 0, 0)], [text('b', 'Settings', 0, 0)], { width: 1280, height: 800 });
    expect(m.pairs).toEqual([]);
  });
});

describe('checkConformity copy', () => {
  const inv = (texts: string[]) => ({ colors: [], fontSizes: [], fontFamilies: [], radii: [], texts });
  const missing = (texts: string[], els: ReturnType<typeof text>[]) =>
    checkConformity(inv(texts), screen(els), cfg)
      .findings.filter((f) => f.kind === 'copy-missing')
      .map((f) => f.label);
  it('a design string is found as whole words inside one element, not across the page', () => {
    const page = [
      text('1', 'Payment history', 0, 0),
      text('2', 'Cancellation policy', 0, 30),
      text('3', 'Log', 0, 60),
      text('4', 'in', 40, 60),
    ];
    expect(missing(['Pay', 'Cancel', 'Log in'], page)).toEqual(['Pay', 'Cancel', 'Log in']);
  });
  it('still finds the copy where it really is, with whitespace and typography normalised', () => {
    const page = [text('1', 'Pay  now', 0, 0), text('2', 'Ready? Log in.', 0, 30), text('3', 'Don’t cancel', 0, 60)];
    expect(missing(['Pay', 'Log in', "Don't cancel", 'now'], page)).toEqual([]);
  });
});

describe('sameFace', () => {
  it('the same family with a weight or style suffix, or a metric twin, is the same face', () => {
    expect(sameFace('inter', 'Inter')).toBe(true);
    expect(sameFace('inter', 'Inter Bold')).toBe(true);
    expect(sameFace('inter', 'Inter-SemiBold Italic')).toBe(true);
    expect(sameFace('roboto', 'Roboto Regular')).toBe(true);
    expect(sameFace('arial', 'Liberation Sans')).toBe(true);
  });
  it('a shorter name, or a longer one that is another family, is a fallback', () => {
    expect(sameFace('noto sans jp', 'Noto Sans')).toBe(false);
    expect(sameFace('roboto slab', 'Roboto')).toBe(false);
    expect(sameFace('inter', 'Inter Tight')).toBe(false);
    expect(sameFace('open sans', 'Open Sans Condensed Light')).toBe(false);
  });
});
