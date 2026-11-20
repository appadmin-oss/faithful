import { describe, expect, it } from 'vitest';
import type { AuditFacts } from '../src/audit.js';
import { compareParity, matchControls, normHref, selfCheck } from '../src/parity.js';

const page = (over: Partial<AuditFacts> = {}): AuditFacts => ({
  viewport: { width: 1280, height: 800 },
  url: 'http://shop.test/',
  scrollWidth: 1280,
  overflow: [],
  clipped: [],
  overlaps: [],
  covered: [],
  brokenImages: [],
  invisible: [],
  paragraphs: [],
  targets: [],
  controls: [
    { sel: 'a1', role: 'link', name: 'Books', href: '/books', visible: true },
    { sel: 'a2', role: 'link', name: 'My orders', href: '/orders', visible: true },
    { sel: 'b1', role: 'button', name: 'Add to basket', visible: true },
  ],
  forms: [
    {
      sel: 'f',
      action: '/newsletter',
      method: 'post',
      fields: [{ name: 'email', type: 'email', required: true, label: 'Email' }],
      submits: ['Subscribe'],
    },
  ],
  landmarks: ['banner', 'contentinfo', 'main', 'navigation'],
  headings: [{ sel: 'h1', level: 1, text: 'Find your next book' }],
  fontSizes: [],
  texts: [],
  imageSrcs: [],
  runtime: { errors: [], failed: [], status: 200 },
  slop: {
    gradientText: [],
    glass: [],
    glow: [],
    emojiIcons: [],
    sideStripes: [],
    nestedCards: [],
    badgeAboveH1: null,
    iconTiles: 0,
    cardGrids: 0,
    accentHues: [],
    fonts: [],
  },
  ...over,
});
const out = (b: AuditFacts, a: AuditFacts) => compareParity(b, a, 's').findings.map((f) => `${f.severity}:${f.kind}`);

describe('parity', () => {
  it('the same product passes, whatever the markup, order or origin', () => {
    const a = page({
      url: 'http://new.test/shop/',
      controls: [...page().controls].reverse().map((c) => ({ ...c, sel: `x-${c.sel}` })),
    });
    expect(compareParity(page(), page({ url: 'http://shop.test/' }), 's').findings).toEqual([]);
    expect(out(page(), { ...a, url: 'http://shop.test/' })).toEqual([]);
  });

  it('a dropped control is lost; one with the same name going elsewhere is changed', () => {
    expect(out(page(), page({ controls: page().controls.slice(1) }))).toEqual(['error:lost']);
    const moved = page({
      controls: page().controls.map((c) => (c.name === 'Books' ? { ...c, href: '/catalogue' } : c)),
    });
    expect(out(page(), moved)).toEqual(['error:changed']);
  });

  it('a renamed control is matched by its target and flagged for confirmation, never passed silently', () => {
    const r = compareParity(
      page(),
      page({ controls: page().controls.map((c) => (c.name === 'My orders' ? { ...c, name: 'Your orders' } : c)) }),
      's',
    );
    expect(r.findings.map((f) => f.kind)).toEqual(['renamed']);
    expect(r.findings[0]?.detail).toContain('"My orders" is now "Your orders"');
  });

  it('a duplicated control is counted: three "Learn more" before and two after is one lost', () => {
    const lm = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        sel: `l${i}`,
        role: 'link' as const,
        name: 'Learn more',
        href: '#',
        visible: true,
      }));
    expect(out(page({ controls: lm(3) }), page({ controls: lm(2) }))).toEqual(['error:lost']);
  });

  it('forms: the server reads NAMES, so a renamed field is lost, with the likely new name offered', () => {
    const f = page().forms[0] as AuditFacts['forms'][number];
    const r = compareParity(
      page(),
      page({ forms: [{ ...f, fields: [{ name: 'emailAddress', type: 'email', required: true, label: 'Email' }] }] }),
      's',
    );
    expect(r.findings.map((x) => `${x.severity}:${x.kind}`)).toEqual(['error:lost']);
    expect(r.findings[0]?.detail).toMatch(/field "email".*is it "emailAddress"\?/);
    expect(out(page(), page({ forms: [{ ...f, action: '/subscribe' }] }))).toEqual(['error:changed']);
    expect(out(page(), page({ forms: [{ ...f, method: 'get' }] }))).toEqual(['error:changed']);
    expect(
      out(
        page(),
        page({
          forms: [
            { ...f, fields: [{ ...(f.fields[0] as AuditFacts['forms'][number]['fields'][number]), required: false }] },
          ],
        }),
      ),
    ).toEqual(['warn:changed']);
    expect(out(page(), page({ forms: [] }))).toEqual(['error:lost']);
  });

  it('a page that 404s after answering before is lost; a lost landmark or H1 warns; new script errors fail', () => {
    expect(out(page(), page({ runtime: { errors: [], failed: [], status: 404 } }))).toEqual(['error:lost']);
    expect(out(page(), page({ landmarks: ['banner', 'main', 'navigation'] }))).toEqual(['warn:lost']);
    expect(out(page(), page({ headings: [] }))).toEqual(['warn:lost']);
    expect(
      out(
        page({ runtime: { errors: ['old'], failed: [] } }),
        page({ runtime: { errors: ['old', 'TypeError: x is undefined'], failed: [] } }),
      ),
    ).toEqual(['error:runtime']);
  });

  it('a control hidden in a menu after the redesign is still there (a note, not a loss)', () => {
    const r = compareParity(
      page(),
      page({ controls: page().controls.map((c) => ({ ...c, visible: c.name !== 'Books' })) }),
      's',
    );
    expect(r.findings.map((f) => `${f.severity}:${f.kind}`)).toEqual(['info:changed']);
  });

  it('hrefs compare across origins and trailing slashes; "#" and javascript: are no target', () => {
    expect(normHref('/orders/', 'http://a.test/')).toBe('/orders');
    expect(normHref('http://a.test/orders', 'http://a.test/x')).toBe('/orders');
    expect(normHref('#', 'http://a.test/')).toBe('');
    expect(normHref('javascript:void(0)', 'http://a.test/')).toBe('');
    expect(
      matchControls(page().controls, page().controls, 'http://a.test/', 'http://b.test/').every(
        (m) => m.how === 'same',
      ),
    ).toBe(true);
  });

  it('a file page and its served copy agree: the private folder is the site root, index.html its folder', () => {
    const file = 'http://faithful.localhost/__faithful__/index.html';
    for (const [href, want] of [
      ['about.html', '/about.html'],
      ['/docs', '/docs'],
      ['#pricing', '#pricing'],
      ['index.html', '/'],
    ] as const) {
      expect(normHref(href, file)).toBe(want);
      expect(normHref(href, 'http://localhost:8080/')).toBe(want);
      expect(normHref(href, 'http://localhost:8080/index.html')).toBe(want);
    }
    const links = page().controls.map((c, i) => (c.href ? { ...c, href: ['books.html', 'orders/'][i] } : c));
    const r = compareParity(
      page({ url: file, controls: links }),
      page({ url: 'http://localhost:8080/', controls: links }),
      's',
    );
    expect(r.findings).toEqual([]);
  });

  it('but a link that really goes somewhere else is still reported between a file and a server', () => {
    const file = 'http://faithful.localhost/__faithful__/index.html';
    const moved = page().controls.map((c) => (c.name === 'My orders' ? { ...c, href: '/account/orders' } : c));
    const r = compareParity(page({ url: file }), page({ url: 'http://localhost:8080/', controls: moved }), 's');
    expect(r.findings.map((f) => f.detail)).toEqual(['link "My orders" now goes to /account/orders, not /orders']);
  });

  it('query parameters in another order are the same target; a changed value is not', () => {
    expect(normHref('/docs/?b=2&a=1', 'http://a.test/')).toBe(normHref('/docs?a=1&b=2', 'http://b.test/'));
    const q = (href: string) => page({ controls: [{ sel: 'a', role: 'link', name: 'Docs', href, visible: true }] });
    expect(compareParity(q('/docs/?b=2&a=1'), q('/docs?a=1&b=2'), 's').findings).toEqual([]);
    expect(compareParity(q('/docs?b=2&a=1'), q('/docs?a=1&b=3'), 's').findings.map((f) => f.kind)).toEqual(['changed']);
  });

  it('form actions compare like links (trailing slash, file vs server); an empty method is GET', () => {
    const form = (action: string, method: string) =>
      page({ forms: [{ ...(page().forms[0] as AuditFacts['forms'][number]), action, method }] });
    expect(compareParity(form('/newsletter', 'post'), form('/newsletter/', 'POST'), 's').findings).toEqual([]);
    expect(compareParity(form('', ''), form('', 'get'), 's').findings).toEqual([]);
    expect(
      compareParity(
        { ...form('subscribe', 'post'), url: 'http://faithful.localhost/__faithful__/index.html' },
        form('/subscribe/', 'post'),
        's',
      ).findings,
    ).toEqual([]);
    // Real changes of the same shape are still errors.
    const moved = compareParity(form('/newsletter', 'post'), form('/subscribe', 'post'), 's').findings;
    expect(moved.map((f) => f.detail)).toEqual(['a form now sends to /subscribe, not /newsletter']);
    const verb = compareParity(form('/newsletter', ''), form('/newsletter', 'post'), 's').findings;
    expect(verb.map((f) => f.detail)).toEqual(['a form now sends by POST, not GET']);
  });

  it('checks itself: a page with nothing to compare is inconclusive, not a pass', () => {
    expect(selfCheck(page()).ok).toBe(true);
    expect(selfCheck(page({ controls: [], forms: [] }))).toEqual({
      ok: false,
      reason: expect.stringMatching(/no links, buttons or forms/),
    });
  });
});
