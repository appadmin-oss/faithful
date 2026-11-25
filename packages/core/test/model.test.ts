import { describe, expect, it } from 'vitest';
import type { AuditFacts } from '../src/audit-facts.js';
import { buildModel, judgeAgainstModel } from '../src/model.js';

/** Only what the model reads; the rest of a page's facts play no part. */
const page = (p: {
  sizes: [number, number][];
  radii?: [number, number][];
  colors?: [string, number][];
  buttons?: { radius: number; height: number; text?: string }[];
  h1?: number;
  strip?: number;
  spacing?: [number, number, string][];
}): AuditFacts =>
  ({
    headings: p.h1 ? [{ sel: 'h1', level: 1, text: 'Members', size: p.h1 }] : [],
    spacing: p.spacing ?? [],
    navs: p.strip ? [{ sel: 'nav', label: 'Sections', entries: [], strip: p.strip }] : [],
    palette: {
      sizes: p.sizes,
      radii: p.radii ?? [],
      colors: p.colors ?? [],
      buttons: (p.buttons ?? []).map((b) => ({
        sel: 'button',
        text: b.text ?? 'Save',
        fontSize: 14,
        fontWeight: 500,
        ...b,
      })),
    },
  }) as unknown as AuditFacts;

const reference = [
  page({
    sizes: [
      [14, 120],
      [13, 60],
      [26, 1],
      [19, 1],
    ],
    radii: [
      [8, 40],
      [10, 20],
      [3, 1],
    ],
    colors: [
      ['#111111', 90],
      ['#6b7280', 40],
      ['#e5e7eb', 30],
    ],
    buttons: [
      { radius: 10, height: 36 },
      { radius: 10, height: 36 },
      { radius: 8, height: 28 },
    ],
    h1: 26,
    strip: 6,
    spacing: [
      [4, 30, 'a'],
      [8, 50, 'b'],
      [12, 25, 'c'],
      [16, 40, 'd'],
      [24, 20, 'e'],
      [32, 12, 'f'],
      [48, 6, 'g'],
    ],
  }),
  page({
    sizes: [
      [14, 80],
      [13, 30],
    ],
    radii: [[8, 30]],
    colors: [['#111111', 50]],
    h1: 26,
    strip: 5,
  }),
];

describe('style model', () => {
  const m = buildModel(reference.map((facts, i) => ({ source: `ref${i}`, facts })));

  it('keeps what the reference uses, not what it used once', () => {
    expect(m.sizes).toEqual([13, 14]);
    expect(m.radii).toEqual([8, 10]);
    expect(m.titles).toEqual([26]);
    expect(m.navMax).toBe(6);
    expect(m.buttons).toContainEqual({ radius: 10, height: 36 });
    expect(m.grid?.unit).toBe(8);
  });

  it('a page drawn from the same system is on it, with no warning', () => {
    const r = judgeAgainstModel(reference[0] as AuditFacts, m);
    expect(r.measures.type).toBeGreaterThanOrEqual(98);
    expect(r.findings.filter((f) => f.severity === 'warn')).toEqual([]);
  });

  it('a page from another system is measured off it, with the value to use', () => {
    const other = page({
      sizes: [
        [15, 100],
        [17, 40],
      ],
      radii: [[16, 30]],
      colors: [['#1b2430', 80]],
      buttons: [{ radius: 6, height: 26, text: 'Comfortable rows' }],
      h1: 30,
      strip: 13,
      spacing: [
        [10, 40, 'x'],
        [18, 20, 'y'],
      ],
    });
    const r = judgeAgainstModel(other, m);
    expect(r.measures).toMatchObject({ type: 0, radius: 0, buttons: 0, colour: 0, spacing: 0 });
    const said = r.findings.map((f) => `${f.severity} ${f.detail}`).join('\n');
    expect(said).toMatch(/warn 0% of the text .*15px ×100 → 14px/);
    expect(said).toMatch(/16px ×30 → 10px/);
    expect(said).toMatch(/26px tall with 6px corners ×1 \(e\.g\. "Comfortable rows"\)/);
    expect(said).toMatch(/page title is 30px; the model's titles are 26px/);
    expect(said).toMatch(/13 entries in one strip; the model's longest holds 6/);
  });

  it('one stray value on a page of hundreds is a note, not a warning', () => {
    const r = judgeAgainstModel(
      page({
        sizes: [
          [14, 300],
          [15, 2],
        ],
      }),
      m,
    );
    const type = r.findings.find((f) => f.kind === 'scale');
    expect(type?.severity).toBe('info');
  });
});
