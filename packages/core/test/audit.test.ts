import { describe, expect, it } from 'vitest';
import { type AuditFacts, mergeViewports, scoreAudit } from '../src/audit.js';

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
});
