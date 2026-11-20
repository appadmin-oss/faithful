import { describe, expect, it } from 'vitest';
import { type AuditFacts, type AxeRule, mergeViewports, scoreAudit, stressDelta } from '../src/audit.js';

const clean = (over: Partial<AuditFacts> = {}, slop: Partial<AuditFacts['slop']> = {}): AuditFacts => ({
  viewport: { width: 375, height: 812 },
  url: 'http://x.test/',
  scrollWidth: 375,
  overflow: [],
  clipped: [],
  overlaps: [],
  covered: [],
  brokenImages: [],
  invisible: [],
  paragraphs: [{ sel: 'p', cpl: 60, lines: 4, lineHeight: 1.5, fontSize: 17, centred: false }],
  targets: [],
  controls: [{ sel: 'a', role: 'link', name: 'Apply for a plot', href: '/apply', visible: true }],
  forms: [],
  landmarks: ['main'],
  headings: [{ sel: 'h1', level: 1, text: 'Twelve plots free this spring' }],
  fontSizes: [15, 17, 24, 38],
  texts: [{ sel: 'h1', text: 'Twelve plots free this spring' }],
  imageSrcs: [],
  runtime: { errors: [], failed: [] },
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
    fonts: ['georgia'],
    ...slop,
  },
  ...over,
});
const kinds = (f: AuditFacts) => scoreAudit(f, 's').findings.map((x) => `${x.severity}:${x.kind}`);

describe('scoreAudit', () => {
  it('a clean page has no findings', () => {
    expect(scoreAudit(clean(), 's').findings).toEqual([]);
  });

  it('sideways scroll is an error on a phone and a warning on a desktop', () => {
    expect(kinds(clean({ scrollWidth: 1200, overflow: [{ sel: '.wide', right: 1200, text: '' }] }))).toEqual([
      'error:overflow',
    ]);
    expect(kinds(clean({ viewport: { width: 1440, height: 900 }, scrollWidth: 1500 }))).toEqual(['warn:overflow']);
  });

  it('unrendered values are errors; ordinary words that merely contain them are not', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: an unrendered template literal is the fault under test
    for (const t of ['undefined', 'NaN', '[object Object]', 'Hello {{ user.name }}', 'Total: ${total}']) {
      expect(kinds(clean({ texts: [{ sel: 'p', text: t }] })), t).toEqual(['error:placeholder']);
    }
    for (const t of ['Undefined behaviour is explained below', 'null and void', 'Nancy']) {
      expect(kinds(clean({ texts: [{ sel: 'p', text: t }] })), t).toEqual([]);
    }
  });

  it('a target short in either dimension is a warning (WCAG 2.5.8) unless it is spaced clear of the others', () => {
    const t = (w: number, h: number, spaced?: boolean) =>
      clean({ targets: [{ sel: 'a', text: 'Docs', w, h, ...(spaced ? { spaced } : {}) }] });
    expect(kinds(t(200, 12))).toEqual(['warn:target']);
    expect(kinds(t(12, 200))).toEqual(['warn:target']);
    expect(kinds(t(14, 14))).toEqual(['warn:target']);
    expect(kinds(t(200, 12, true))).toEqual([]);
    expect(kinds(t(24, 24))).toEqual([]);
  });

  it('a failed request for a broken image is the same fault once, not twice', () => {
    const f = clean({
      brokenImages: [{ sel: 'img', src: 'team.png' }],
      runtime: { errors: [], failed: [{ url: 'http://x/team.png', status: 404 }] },
    });
    expect(kinds(f)).toEqual(['error:broken']);
  });

  it('ONE tell is a warning and never decides the verdict; many together are an error', () => {
    expect(kinds(clean({}, { gradientText: ['h1'] }))).toEqual(['warn:slop']);
    const many = clean(
      {
        paragraphs: Array.from({ length: 6 }, () => ({
          sel: 'p',
          cpl: 60,
          lines: 1,
          lineHeight: 1.5,
          fontSize: 17,
          centred: true,
        })),
      },
      {
        gradientText: ['h1'],
        glow: ['a'],
        emojiIcons: [{ sel: 'a', text: '🚀 Go' }],
        badgeAboveH1: '.badge',
        accentHues: [262],
        fonts: ['inter'],
      },
    );
    const r = scoreAudit(many, 's');
    const summary = r.findings.find((x) => x.detail.startsWith('reads as generated'));
    expect(summary?.severity).toBe('error');
    expect(summary?.detail).toMatch(/^reads as generated: 7 known tells/);
  });

  it('weak tells alone — a purple brand, Inter, a card row — are not reported at all', () => {
    expect(kinds(clean({}, { accentHues: [262], fonts: ['inter'], cardGrids: 1 }))).toEqual([]);
  });

  it('readability: long lines, tight leading, small body text; short or one-line copy is exempt', () => {
    expect(
      kinds(clean({ paragraphs: [{ sel: 'p', cpl: 120, lines: 5, lineHeight: 1.5, fontSize: 17, centred: false }] })),
    ).toEqual(['warn:readability']);
    expect(
      kinds(clean({ paragraphs: [{ sel: 'p', cpl: 60, lines: 5, lineHeight: 1.1, fontSize: 17, centred: false }] })),
    ).toEqual(['warn:readability']);
    expect(
      kinds(clean({ paragraphs: [{ sel: 'p', cpl: 140, lines: 1, lineHeight: 1.1, fontSize: 11, centred: false }] })),
    ).toEqual([]);
  });

  it('merging viewports: one finding per fault, the widest tell count kept', () => {
    const a = scoreAudit(
      clean(
        { clipped: [{ sel: '.x', text: 'Long label', axis: 'y', by: 20 }] },
        { gradientText: ['h1'], glow: ['a'], emojiIcons: [{ sel: 'a', text: '🚀' }] },
      ),
      'a',
    );
    const b = scoreAudit(
      clean(
        { viewport: { width: 1440, height: 900 }, clipped: [{ sel: '.x', text: 'Long label', axis: 'y', by: 20 }] },
        { gradientText: ['h1'], glow: ['a'], emojiIcons: [{ sel: 'a', text: '🚀' }], nestedCards: ['.c'] },
      ),
      'b',
    );
    mergeViewports([a, b]);
    const all = [...a.findings, ...b.findings];
    expect(all.filter((f) => f.kind === 'clipped')).toHaveLength(1);
    expect(all.filter((f) => f.kind === 'clipped')[0]?.viewport).toBe('375x812,1440x900');
    const summaries = all.filter((f) => f.detail.startsWith('reads as generated'));
    expect(summaries.map((s) => s.detail.slice(0, 22))).toEqual(['reads as generated: 4 ']);
  });

  it('wording: vague links, generic buttons, two names for one action, mixed heading case, doubled words', () => {
    const k = (over: Partial<AuditFacts>) =>
      scoreAudit(clean(over), 's')
        .findings.filter((x) => x.kind === 'wording')
        .map((x) => x.detail);
    expect(k({ controls: [{ sel: 'a', role: 'link', name: 'Click here', href: '/a', visible: true }] })[0]).toMatch(
      /named only "Click here"/,
    );
    expect(
      k({
        controls: [
          { sel: 'a', role: 'link', name: 'Learn more', href: '/a' },
          { sel: 'b', role: 'link', name: 'Learn more →', href: '/b' },
        ],
      })[0],
    ).toMatch(/2 different places/);
    // One "Learn more" to one place is understandable in context: not flagged.
    expect(k({ controls: [{ sel: 'a', role: 'link', name: 'Learn more', href: '/a', visible: true }] })).toEqual([]);
    expect(k({ controls: [{ sel: 'b', role: 'button', name: 'Submit', visible: true }] })[0]).toMatch(/"Submit"/);
    expect(
      k({
        controls: [
          { sel: 'a', role: 'link', name: 'Sign in', href: '/s' },
          { sel: 'b', role: 'button', name: 'Log in' },
        ],
      })[0],
    ).toMatch(/Sign in \/ Log in/);
    expect(
      k({
        headings: [
          { sel: 'h2', level: 2, text: 'Plans That Grow With Teams' },
          { sel: 'h2', level: 2, text: 'How billing works for every team' },
        ],
      })[0],
    ).toMatch(/mix Title Case/);
    expect(k({ texts: [{ sel: 'p', text: 'Fill in the the form' }] })[0]).toMatch(/repeated word "the the"/);
    expect(k({ texts: [{ sel: 'p', text: 'She said that that was fine' }] })).toEqual([]);
  });

  describe('contrast (WCAG 1.4.3)', () => {
    type TC = NonNullable<AuditFacts['textColors']>[number];
    const grey = (v: number): [number, number, number] => [v, v, v];
    const W = grey(255);
    const tc = (fg: number, size = 16, weight = 400, over: Partial<TC> = {}): TC => ({
      sel: `p.g${fg}`,
      text: `grey ${fg}`,
      fg: grey(fg),
      bg: W,
      size,
      weight,
      ...over,
    });
    const run = (textColors: TC[], over: Partial<AuditFacts> = {}) =>
      scoreAudit(clean({ textColors, ...over }), 's').findings.filter((x) => x.kind === 'contrast');

    it('4.5:1 for body text, exactly at the line: #767676 passes, #777777 (4.48:1) fails and is not printed as 4.5', () => {
      expect(run([tc(0x76)])).toEqual([]);
      const [f] = run([tc(0x77)]);
      expect(f?.severity).toBe('warn');
      expect(f?.detail).toBe('"grey 119" #777777 on #ffffff is 4.47:1 at 16px; needs 4.5:1');
    });

    it('large text needs 3:1: 24px, or bold from 18.66px; 18px bold and 23px regular are not large', () => {
      expect(run([tc(0x88, 24)])).toEqual([]);
      expect(run([tc(0x88, 18.67, 700)])).toEqual([]);
      expect(run([tc(0x88, 18, 700)])).toHaveLength(1);
      expect(run([tc(0x88, 23, 400)])).toHaveLength(1);
      // Under 3:1 fails at any size: an error.
      expect(run([tc(0xaa, 32)])[0]?.severity).toBe('error');
    });

    it('one finding per colour pair and size, with a count; forty grey captions are one fault', () => {
      const many = Array.from({ length: 40 }, (_, i) => tc(0xaa, 14, 400, { sel: `li:nth-of-type(${i + 1})` }));
      const f = run([...many, tc(0x99, 14), tc(0xaa, 20)]);
      expect(f.map((x) => x.detail.replace(/^"[^"]*" /, ''))).toEqual([
        '#aaaaaa on #ffffff is 2.32:1 at 14px; needs 4.5:1 (×40 texts)',
        '#aaaaaa on #ffffff is 2.32:1 at 20px; needs 4.5:1',
        '#999999 on #ffffff is 2.84:1 at 14px; needs 4.5:1',
      ]);
    });

    it('past six pairs, the rest are one finding', () => {
      const pairs = Array.from({ length: 10 }, (_, i) => tc(0x90 + i * 4));
      const f = run(pairs);
      expect(f).toHaveLength(7);
      expect(f[6]?.detail).toMatch(/^4 more low-contrast colour pairs \(4 texts\)/);
    });

    it('a failing text with a shadow, and unmeasurable text, are one note, never a pass or a fault', () => {
      const f = run([tc(0xcc, 16, 400, { shadow: true })], {
        contrastUnknown: { n: 2, sel: 'h1', why: 'a background image or gradient' },
      });
      expect(f.map((x) => `${x.severity}:${x.detail}`)).toEqual([
        'info:contrast not judged for 3 texts (a background image or gradient): check by eye',
      ]);
      // A shadowed text that passes on its own needs no excuse.
      expect(run([tc(0x33, 16, 400, { shadow: true })])).toEqual([]);
    });

    it('native controls drawn light under dark styles are a warning', () => {
      const f = run([], { lightControls: { n: 2, sel: 'input' } });
      expect(f.map((x) => x.severity)).toEqual(['warn']);
      expect(f[0]?.detail).toMatch(/2 native form controls are drawn light.*color-scheme/);
    });

    it('the same pair at two widths is one finding, even when the count differs', () => {
      const a = scoreAudit(clean({ textColors: [tc(0xaa), tc(0xaa)] }), 'a');
      const b = scoreAudit(
        clean({ viewport: { width: 1440, height: 900 }, textColors: [tc(0xaa), tc(0xaa), tc(0xaa)] }),
        'b',
      );
      mergeViewports([a, b]);
      const all = [...a.findings, ...b.findings].filter((x) => x.kind === 'contrast');
      expect(all).toHaveLength(1);
      expect(all[0]?.viewport).toBe('375x812,1440x900');
    });
  });
});

describe('scoreAudit: axe-core results', () => {
  const rule = (id: string, impact: AxeRule['impact'], n = 1, sel = `#${id}`): AxeRule => ({
    id,
    impact,
    help: `${id} help`,
    helpUrl: `https://dequeuniversity.com/rules/axe/4.14/${id}?application=axeAPI`,
    n,
    sel,
  });
  const axe = (violations: AxeRule[], incomplete: AxeRule[] = []) => clean({ axe: { violations, incomplete } });

  it('one finding per rule: critical/serious an error, moderate/minor a warning, the count and first element', () => {
    const r = scoreAudit(
      axe([
        rule('label', 'critical', 3, 'input[name="q"]'),
        rule('image-alt', 'serious'),
        rule('list', 'moderate'),
        rule('x', 'minor'),
        rule('y', null),
      ]),
      's',
    );
    expect(r.findings.map((x) => `${x.severity}:${x.kind}:${x.detail}`)).toEqual([
      'error:a11y:label: label help (×3)',
      'error:a11y:image-alt: image-alt help',
      'warn:a11y:list: list help',
      'warn:a11y:x: x help',
      'warn:a11y:y: y help',
    ]);
    expect(r.findings[0]?.buildId).toBe('input[name="q"]');
    // The help page goes to `explain`, never into the one-line detail.
    expect(r.findings[0]?.help).toBe('https://dequeuniversity.com/rules/axe/4.14/label');
    expect(r.findings[0]?.detail).not.toMatch(/https?:/);
    // A long help line is cut at a word, not mid-word.
    const long = {
      ...rule('definition-list', 'serious'),
      help: '<dl> elements must only directly contain properly-ordered <dt> and <dd> groups',
    };
    expect(scoreAudit(axe([long]), 's').findings[0]?.detail).toBe(
      'definition-list: <dl> elements must only directly contain properly-ordered…',
    );
  });

  it('rules Faithful measures itself (contrast, target size) are never reported from axe too', () => {
    const f = clean({
      axe: {
        violations: [rule('color-contrast', 'serious'), rule('target-size', 'serious')],
        incomplete: [rule('color-contrast', 'serious', 4)],
      },
    });
    expect(scoreAudit(f, 's').findings).toEqual([]);
    // The same shape from a rule Faithful does not measure is still reported.
    expect(kinds(axe([rule('button-name', 'critical')]))).toEqual(['error:a11y']);
  });

  it('"needs review" is one note counted by rule: never a pass, never a fault', () => {
    const r = scoreAudit(axe([], [rule('aria-hidden-focus', 'serious', 2), rule('video-caption', 'critical')]), 's');
    expect(r.findings.map((x) => `${x.severity}:${x.kind}`)).toEqual(['info:a11y']);
    expect(r.findings[0]?.detail).toBe(
      'needs review: axe-core could not decide 3 elements (aria-hidden-focus ×2, video-caption ×1): check by hand',
    );
    expect(r.score).toBe(100);
  });

  it('an axe that did not run is an unmeasured warning, never a clean page; switched off it says nothing', () => {
    expect(
      scoreAudit(clean({ axe: { error: 'axe-core did not load\n  at x' } }), 's').findings.map(
        (x) => `${x.severity}:${x.kind}:${x.detail}`,
      ),
    ).toEqual([
      "warn:unmeasured:axe-core did not run (axe-core did not load): the WCAG rules beyond Faithful's own are unmeasured",
    ]);
    expect(scoreAudit(clean(), 's').findings).toEqual([]);
  });

  it('merging viewports: one finding per rule, whichever element each width met first', () => {
    const a = scoreAudit(axe([rule('label', 'critical', 2, '#a')], [rule('aria-hidden-focus', 'serious', 1)]), 'a');
    const b = scoreAudit(
      clean({
        viewport: { width: 1440, height: 900 },
        axe: {
          violations: [rule('label', 'critical', 3, '#b')],
          incomplete: [rule('aria-hidden-focus', 'serious', 2)],
        },
      }),
      'b',
    );
    mergeViewports([a, b]);
    const all = [...a.findings, ...b.findings];
    expect(all.map((x) => `${x.severity}:${x.kind}`)).toEqual(['error:a11y', 'info:a11y']);
    expect(all[0]?.viewport).toBe('375x812,1440x900');
    // Two different rules on the same element stay two findings.
    const c = scoreAudit(
      axe([rule('label', 'critical', 1, '#a'), rule('autocomplete-valid', 'serious', 1, '#a')]),
      'c',
    );
    mergeViewports([c]);
    expect(c.findings).toHaveLength(2);
  });
});

describe('stressDelta (audit --stress)', () => {
  const cut = (sel: string, side?: 'left') => ({
    sel,
    text: 'Save draft',
    axis: 'x' as const,
    by: 30,
    ...(side ? { side } : {}),
  });
  it('keeps only the layout faults a pass ADDS, each saying what caused it', () => {
    const normal = scoreAudit(clean({ clipped: [cut('.a')] }), 'n');
    const stressed = scoreAudit(
      clean({
        clipped: [cut('.a'), cut('.b')],
        overlaps: [{ a: '.c', b: '.d', text: 'One', other: 'Two' }],
        // Not a stress pass's business: the pseudo text is not a placeholder.
        texts: [{ sel: 'p', text: 'Lorem ipsum dolor' }],
      }),
      'n expand',
    );
    const d = stressDelta(normal, stressed, 'expand');
    expect(d.findings.map((f) => `${f.kind} ${f.buildId}`)).toEqual(['clipped .b', 'overlap .c']);
    expect(d.findings[0]?.detail).toMatch(/^with text 1\.3–2× longer, as in translation: "Save draft" is cut off/);
    expect(d.score).toBe(80);
    // Without the normal pass to subtract, .a would be reported twice.
    expect(stressDelta(scoreAudit(clean(), 'n'), stressed, 'expand').findings).toHaveLength(3);
  });

  it('a page already scrolling sideways is not reported again for another culprit; a new sideways scroll is', () => {
    const wide = (sel: string) => clean({ scrollWidth: 600, overflow: [{ sel, right: -200, text: '' }] });
    const already = stressDelta(scoreAudit(wide('.x'), 'n'), scoreAudit(wide('.menu'), 'r'), 'rtl');
    expect(already.findings).toEqual([]);
    const fresh = stressDelta(scoreAudit(clean(), 'n'), scoreAudit(wide('.menu'), 'r'), 'rtl');
    expect(fresh.findings.map((f) => f.detail)).toEqual([
      expect.stringMatching(/^in right-to-left: the page scrolls sideways/),
    ]);
  });

  it('right-to-left text cut at its start edge says the left edge', () => {
    expect(scoreAudit(clean({ clipped: [cut('.a', 'left')] }), 's').findings[0]?.detail).toMatch(
      /\(left edge of its box\)/,
    );
    expect(scoreAudit(clean({ clipped: [cut('.a')] }), 's').findings[0]?.detail).toMatch(/\(right edge of its box\)/);
  });
});
