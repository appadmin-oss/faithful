import type { Provenance } from '@usefaithful/spec';
import { describe, expect, it } from 'vitest';
import { scoreAudit } from '../src/audit.js';
import { compareScreens } from '../src/compare.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { explain, formatCompact, formatText, summarise } from '../src/report.js';
import { screen, text } from './helpers.js';

const prov: Provenance = {
  adapter: 'test',
  adapterVersion: '0',
  format: 'test@1',
  tier: 'structured',
  confidence: 1,
  source: 'x',
  warnings: [],
};

/** A rough token count (≈4 characters per token for English and code). */
const tokens = (s: string) => Math.ceil(s.length / 4);

function noisy(n: number) {
  const d = Array.from({ length: n }, (_, i) =>
    text(`t${i}`, `Design line number ${i} with some words`, 20, 20 + i * 30, 400, 24),
  );
  const b = d.map((e, i) => ({
    ...e,
    id: `div:nth-child(${i})`,
    // Odd lines reworded (errors), every fourth line re-capitalised (a warning).
    text: i % 2 ? `Built line number ${i} with other words` : i % 4 === 2 ? e.text.toUpperCase() : e.text,
    style: { ...e.style, fontSize: i % 3 ? 16 : 15 },
  }));
  return summarise([compareScreens(screen(d), screen(b), DEFAULT_CONFIG)], prov, 'placed', 90);
}

describe('report', () => {
  it('a clean run is one line', () => {
    const d = [text('a', 'Hello there', 0, 0)];
    const r = summarise([compareScreens(screen(d), screen(d), DEFAULT_CONFIG)], prov, 'placed', 90);
    expect(formatText(r)).toBe('faithful PASS clean · 100% match · placed · test@1');
  });

  it('a 40-element run with many faults stays under 400 tokens', () => {
    const r = noisy(40);
    expect(r.findings.length).toBeGreaterThan(20);
    const out = formatText(r);
    expect(tokens(out)).toBeLessThan(400);
    // "+N more" counts what is listed — errors and warnings — never the notes.
    const withNotes = {
      ...r,
      findings: [...r.findings, { kind: 'offset' as const, severity: 'info' as const, detail: 'shifted' }],
    };
    const act = withNotes.findings.filter((f) => f.severity !== 'info').length;
    expect(formatText(withNotes)).toContain(`+${act - 8} more`);
    expect(formatText(withNotes)).not.toContain(`+${withNotes.findings.length - 8} more`);
    expect(tokens(JSON.stringify(formatCompact(r)))).toBeLessThan(600);
  });

  it('a page with 40 low-contrast texts in 40 colours stays under the same ceiling', () => {
    const base = scoreAudit(
      {
        viewport: { width: 375, height: 812 },
        url: 'http://x.test/',
        scrollWidth: 375,
        overflow: [],
        clipped: [],
        overlaps: [],
        covered: [],
        brokenImages: [],
        invisible: [],
        paragraphs: [],
        targets: [],
        controls: [],
        forms: [],
        landmarks: [],
        headings: [],
        fontSizes: [16],
        texts: [],
        imageSrcs: [],
        textColors: Array.from({ length: 40 }, (_, i) => ({
          sel: `main>section:nth-of-type(${i + 1})>p.caption`,
          text: `A fairly long caption number ${i} that is too pale`,
          fg: [150 + i, 150 + i, 150 + i] as [number, number, number],
          bg: [255, 255, 255] as [number, number, number],
          size: 14,
          weight: 400,
        })),
        contrastUnknown: { n: 12, sel: 'h1', why: 'a background image or gradient' },
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
      },
      'audit@375',
    );
    const r = summarise([base], prov, 'audit', 0);
    expect(r.findings.filter((f) => f.kind === 'contrast')).toHaveLength(8);
    expect(tokens(formatText(r))).toBeLessThan(400);
    expect(tokens(JSON.stringify(formatCompact(r)))).toBeLessThan(600);
  });

  it('a page failing 40 axe-core rules stays under the same ceiling; the help pages only in explain', () => {
    const base = scoreAudit(
      {
        viewport: { width: 375, height: 812 },
        url: 'http://x.test/',
        scrollWidth: 375,
        overflow: [],
        clipped: [],
        overlaps: [],
        covered: [],
        brokenImages: [],
        invisible: [],
        paragraphs: [],
        targets: [],
        controls: [],
        forms: [],
        landmarks: [],
        headings: [],
        fontSizes: [16],
        texts: [],
        imageSrcs: [],
        axe: {
          violations: Array.from({ length: 40 }, (_, i) => ({
            id: `label-content-name-mismatch-${i}`,
            impact: i % 2 ? ('serious' as const) : ('moderate' as const),
            help: 'Table cell headers attributes must refer to other <th> elements in the same table',
            helpUrl: `https://dequeuniversity.com/rules/axe/4.14/label-content-name-mismatch-${i}?application=axeAPI`,
            n: 10 + i,
            sel: `main>section:nth-of-type(${i + 1})>div.card>button.icon-only`,
          })),
          incomplete: Array.from({ length: 30 }, (_, i) => ({
            id: `review-rule-${i}`,
            impact: 'serious' as const,
            help: 'h',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/x',
            n: 3,
            sel: 'p',
          })),
        },
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
      },
      'audit@375',
    );
    const r = summarise([base], prov, 'audit', 0);
    expect(r.findings.filter((f) => f.kind === 'a11y')).toHaveLength(41);
    const out = formatText(r);
    expect(tokens(out)).toBeLessThan(400);
    expect(out).not.toContain('dequeuniversity');
    expect(tokens(JSON.stringify(formatCompact(r)))).toBeLessThan(600);
    expect(JSON.stringify(formatCompact(r))).not.toContain('dequeuniversity');
    expect(explain(r, 'F1')).toContain(
      'more: https://dequeuniversity.com/rules/axe/4.14/label-content-name-mismatch-1',
    );
  });

  it('prints each fix sentence once per kind, not per finding', () => {
    const out = formatText(noisy(20), 20);
    expect(out.match(/Use the design copy exactly/g)).toHaveLength(1);
  });

  it('errors come before warnings', () => {
    const r = noisy(20);
    const sev = r.findings.map((f) => f.severity);
    // The run must have both, or the ordering is not being tested.
    expect(sev).toContain('error');
    expect(sev).toContain('warn');
    expect(sev.lastIndexOf('error')).toBeLessThan(sev.indexOf('warn'));
  });

  it('a run that fails on the score alone says so', () => {
    const shell = {
      screen: 's',
      viewport: '1280x800',
      stats: compareScreens(screen([]), screen([]), DEFAULT_CONFIG).stats,
    };
    const clean = summarise([{ ...shell, findings: [], score: 87 }], prov, 'placed', 90);
    expect(clean.pass).toBe(false);
    expect(formatText(clean)).toMatch(/^faithful FAIL clean · 87% match < passScore 90 · placed/);
    expect(formatCompact(clean).passScore).toBe(90);
    const warned = summarise(
      [{ ...shell, findings: [{ kind: 'case', severity: 'warn', detail: '"a" → "A"' }], score: 96 }],
      prov,
      'placed',
      99,
    );
    expect(formatText(warned)).toMatch(/^faithful FAIL 0E 1W · 96% match < passScore 99/);
    // Failing on an error is not blamed on the score; passing says nothing about it.
    const errored = summarise(
      [{ ...shell, findings: [{ kind: 'text', severity: 'error', detail: 'x' }], score: 80 }],
      prov,
      'placed',
      90,
    );
    expect(formatText(errored)).not.toContain('passScore');
    expect(formatText(summarise([{ ...shell, findings: [], score: 95 }], prov, 'placed', 90))).toMatch(
      /^faithful PASS clean · 95% match · placed/,
    );
  });

  it('explains a finding by its reference', () => {
    const r = noisy(10);
    expect(explain(r, 'F1')).toContain('kind:');
    expect(explain(r, 'F999')).toContain('no finding');
  });

  it('a low-confidence reading is marked indicative', () => {
    const r = summarise([], { ...prov, confidence: 0.3 }, 'placed', 90);
    expect(r.indicative).toBe(true);
    expect(r.pass).toBe(false);
  });
});
