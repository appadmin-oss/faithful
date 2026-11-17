/**
 * "Advance, don't copy blindly": a build that departs from the design to FIX a measurable
 * fault is credited, not failed — and only when a real threshold is crossed. Plus the
 * deviations ledger: what a team meant to change, with a reason, an owner and an expiry.
 */
import { describe, expect, it } from 'vitest';
import { compareScreens, improvedContrast } from '../src/compare.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { applyDeviations, parseDeviations } from '../src/deviations.js';
import type { Finding } from '../src/findings.js';
import { box, screen, text } from './helpers.js';

describe('crediting improvements', () => {
  it('grey text the design drew at 2.3:1, built at 7:1, is improved — not a colour error', () => {
    const d = [
      box('card', 0, 0, 600, 200, { background: '#ffffff' }),
      text('t', 'Cancel any time.', 20, 20, 300, 24, { color: '#a0a0a0' }),
    ];
    const b = [
      box('card', 0, 0, 600, 200, { background: '#ffffff' }),
      text('t', 'Cancel any time.', 20, 20, 300, 24, { color: '#555555' }),
    ];
    const r = compareScreens(screen(d), screen(b), DEFAULT_CONFIG);
    expect(r.findings.map((f) => `${f.severity}:${f.kind}`)).toEqual(['info:improved']);
    expect(r.findings[0]?.detail).toMatch(/contrast 2\.\d:1 → 7\.\d:1: the design fails WCAG 1\.4\.3/);
  });

  it("a colour change that does not cross the threshold is still a colour finding (taste is the design's)", () => {
    expect(
      improvedContrast(
        text('a', 'x', 0, 0, 10, 10, { color: '#333333' }),
        text('a', 'x', 0, 0, 10, 10, { color: '#000000' }),
        '#ffffff',
        '#ffffff',
      ),
    ).toBeNull();
    const d = [text('t', 'Cancel any time.', 20, 20, 300, 24, { color: '#333333' })];
    const b = [text('t', 'Cancel any time.', 20, 20, 300, 24, { color: '#1d4ed8' })];
    expect(compareScreens(screen(d), screen(b), DEFAULT_CONFIG).findings.map((f) => f.kind)).toEqual(['color']);
  });

  it('large text needs 3:1, not 4.5:1', () => {
    const big = (c: string) => text('h', 'Plans', 0, 0, 200, 40, { color: c, fontSize: 32 });
    expect(improvedContrast(big('#b0b0b0'), big('#888888'), '#ffffff', '#ffffff')).toMatch(/\(3:1\)/);
  });

  it('a control the design drew under the target size, built bigger, is improved; one built SMALLER is not', () => {
    const ctl = (w: number, h: number) => ({ ...box('x', 20, 20, w, h), kind: 'control' as const, interactive: true });
    const grew = compareScreens(screen([ctl(20, 20)]), screen([ctl(44, 44)]), DEFAULT_CONFIG);
    expect(grew.findings.map((f) => f.kind)).toEqual(['improved']);
    const shrank = compareScreens(screen([ctl(60, 60)]), screen([ctl(48, 30)]), DEFAULT_CONFIG);
    expect(shrank.findings.map((f) => f.kind)).toContain('size');
  });
});

describe('deviations ledger', () => {
  const f = (kind: Finding['kind'], detail: string, label?: string): Finding => ({
    kind,
    severity: 'error',
    detail,
    ...(label ? { label } : {}),
  });

  it('a covered finding becomes a note that quotes the reason and the owner', () => {
    const out = applyDeviations(
      [f('renamed', 'link "My orders" is now "Your orders"', 'My orders')],
      [{ kind: 'renamed', match: 'my orders', reason: 'copy review', owner: 'design' }],
      '2026-11-17',
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('info');
    expect(out[0]?.detail).toMatch(/^declared: .* — copy review \(design\)$/);
  });

  it('kind narrows it: a colour deviation does not excuse a lost link with the same words', () => {
    const out = applyDeviations(
      [f('lost', 'link "Book now" is gone', 'Book now')],
      [{ kind: 'color', match: 'Book now', reason: 'brand', owner: 'brand' }],
      '2026-11-17',
    );
    expect(out[0]?.severity).toBe('error');
  });

  it('an expired entry covers nothing; an entry that covers nothing is reported', () => {
    const out = applyDeviations(
      [f('color', 'rgb → rgb', 'Book now')],
      [
        { match: 'Book now', reason: 'trial', owner: 'growth', expires: '2026-10-01' },
        { match: 'Old banner', reason: 'x', owner: 'y' },
      ],
      '2026-11-17',
    );
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.detail).toMatch(/covered this until 2026-10-01/);
    expect(out.some((x) => /deviation "Old banner".*covers nothing/.test(x.detail))).toBe(true);
  });

  it('every entry must say what, why and who', () => {
    expect(() => parseDeviations({ deviations: [{ match: 'x', reason: '', owner: 'me' }] })).toThrow(
      /entry 1 needs a "reason"/,
    );
    expect(() => parseDeviations({ nope: 1 })).toThrow(/expected/);
  });
});
