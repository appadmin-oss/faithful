/**
 * "Advance, don't copy blindly": a build that departs from the design to FIX a measurable
 * fault is credited, not failed — and only when a real threshold is crossed. Plus the
 * deviations ledger: what a team meant to change, with a reason, an owner and an expiry.
 */

import type { Provenance } from '@usefaithful/spec';
import { describe, expect, it } from 'vitest';
import { compareScreens, improvedContrast, rescoreDeclared } from '../src/compare.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { applyDeviations, parseDeviations } from '../src/deviations.js';
import type { Finding } from '../src/findings.js';
import { checkConformity } from '../src/inventory.js';
import { formatText, summarise } from '../src/report.js';
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

  it('bold text from 18.66px is large too (3:1); regular text at that size needs 4.5:1', () => {
    // #949494 on white is about 3.0:1 — passes 3:1, fails 4.5:1. #b0b0b0 is about 2.1:1.
    const t = (c: string, fontWeight: number) =>
      text('h', 'Plans', 0, 0, 200, 30, { color: c, fontSize: 19, fontWeight });
    expect(improvedContrast(t('#b0b0b0', 700), t('#949494', 700), '#ffffff', '#ffffff')).toMatch(/\(3:1\)/);
    expect(improvedContrast(t('#b0b0b0', 400), t('#949494', 400), '#ffffff', '#ffffff')).toBeNull();
    // Under 18.66px, bold is not enough.
    const small = (c: string) => text('h', 'Plans', 0, 0, 200, 30, { color: c, fontSize: 18, fontWeight: 700 });
    expect(improvedContrast(small('#b0b0b0'), small('#949494'), '#ffffff', '#ffffff')).toBeNull();
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

  it('expires must be a real YYYY-MM-DD date: "never", 20200101 and 2026/03/01 do not cover forever', () => {
    const entry = (expires: unknown) => ({ deviations: [{ match: 'Book now', reason: 'r', owner: 'o', expires }] });
    for (const bad of [
      'never',
      20200101,
      '2026/03/01',
      '2026-3-01',
      '01/03/2027',
      '2026-02-30',
      '2026-11-20T23:59:59Z',
      '',
    ])
      expect(() => parseDeviations(entry(bad)), String(bad)).toThrow(
        /entry 1: "expires" must be a date written YYYY-MM-DD/,
      );
    expect(parseDeviations(entry('2027-03-01'))).toHaveLength(1);
    expect(() => parseDeviations({ deviations: [null] })).toThrow(/entry 1 must be an object/);
    expect(() => parseDeviations({ deviations: [{ kind: 'colour', match: 'Book', reason: 'r', owner: 'o' }] })).toThrow(
      /entry 1: unknown kind "colour"/,
    );
  });

  it('match names the element (label words or id), never the detail line, and is at least 3 characters', () => {
    expect(() => parseDeviations({ deviations: [{ match: '0', reason: 'r', owner: 'o' }] })).toThrow(/at least 3/);
    const run = [
      f('size', '100×20 → 300×20', 'Checkout'),
      f('position', 'off by 30px × 0px from where its neighbours put it'),
      { ...f('color', '#000 → #f00 (ΔE 40)', 'Book now'), id: 'cta-book', buildId: 'main > a:nth-child(2)' },
    ];
    const sev = (match: string) =>
      applyDeviations(run, [{ match, reason: 'r', owner: 'o' }], '2026-11-17').map((x) => x.severity);
    // Words that are only in the detail cover nothing.
    expect(sev('neighbours').slice(0, 3)).toEqual(['error', 'error', 'error']);
    expect(sev('300').slice(0, 3)).toEqual(['error', 'error', 'error']);
    // Part of a word is not the word.
    expect(sev('heck').slice(0, 3)).toEqual(['error', 'error', 'error']);
    expect(sev('checkout').slice(0, 3)).toEqual(['info', 'error', 'error']);
    expect(sev('book').slice(0, 3)).toEqual(['error', 'error', 'info']);
    expect(sev('CTA-book').slice(0, 3)).toEqual(['error', 'error', 'info']);
    expect(sev('main > a:nth-child(2)').slice(0, 3)).toEqual(['error', 'error', 'info']);
  });

  it('a finding that names no element is declared only with its kind and a phrase of 8+ characters', () => {
    const run = [
      f('lost', 'the navigation landmark is gone'),
      f('position', 'off by 30px × 0px from where its neighbours put it'),
    ];
    const sev = (d: { match: string; kind?: string }) =>
      applyDeviations(run, [{ ...d, reason: 'r', owner: 'o' }], '2026-11-17')
        .slice(0, 2)
        .map((x) => x.severity);
    expect(sev({ kind: 'lost', match: 'navigation landmark' })).toEqual(['info', 'error']);
    // Without a kind, or with a short phrase, the detail line is never searched.
    expect(sev({ match: 'navigation landmark' })).toEqual(['error', 'error']);
    expect(sev({ kind: 'position', match: '30px' })).toEqual(['error', 'error']);
    // The kind still narrows it.
    expect(sev({ kind: 'position', match: 'navigation landmark' })).toEqual(['error', 'error']);
  });

  it('an expired entry does not shadow a live one for the same element', () => {
    const out = applyDeviations(
      [f('color', 'rgb → rgb', 'Book now')],
      [
        { match: 'Book', reason: 'old', owner: 'o', expires: '2020-01-01' },
        { match: 'Book now', reason: 'brand refresh', owner: 'brand', expires: '2030-01-01' },
      ],
      '2026-11-17',
    );
    expect(out[0]?.severity).toBe('info');
    expect(out[0]?.detail).toMatch(/brand refresh/);
    // The day it expires it still covers; the day after it does not.
    const on = (today: string) =>
      applyDeviations(
        [f('color', 'x', 'Book now')],
        [{ match: 'Book now', reason: 'r', owner: 'o', expires: '2026-11-17' }],
        today,
      )[0]?.severity;
    expect(on('2026-11-17')).toBe('info');
    expect(on('2026-11-18')).toBe('error');
    // An entry that never went through parseDeviations does not cover forever either.
    const raw = (expires: string) =>
      applyDeviations(
        [f('color', 'x', 'Book now')],
        [{ match: 'Book now', reason: 'r', owner: 'o', expires }],
        '2026-11-17',
      )[0]?.severity;
    expect(raw('never')).toBe('error');
    expect(raw('2026/12/01')).toBe('error');
  });

  it('a declared finding gives back the score it cost; an undeclared one does not', () => {
    const prov: Provenance = {
      adapter: 't',
      adapterVersion: '0',
      format: 't@1',
      tier: 'structured',
      confidence: 1,
      source: 'x',
      warnings: [],
    };
    const d = [text('a', 'Book now', 20, 20, 200, 24)];
    const b = [text('a', 'Book now', 20, 20, 200, 24, { color: '#b00020' })];
    const run = (devs: Parameters<typeof applyDeviations>[1]) => {
      const r = compareScreens(screen(d), screen(b), DEFAULT_CONFIG);
      const before = r.findings;
      r.findings = applyDeviations(before, devs, '2026-11-17');
      rescoreDeclared(r, new Set(before.filter((x, k) => x.severity !== 'info' && r.findings[k]?.severity === 'info')));
      return summarise([r], prov, 'placed', 90);
    };
    const undeclared = run([]);
    expect(undeclared.score).toBeLessThan(90);
    const declared = run([{ kind: 'color', match: 'Book now', reason: 'brand refresh', owner: 'brand' }]);
    expect(declared.counts.error).toBe(0);
    expect(declared.score).toBe(100);
    expect(declared.pass).toBe(true);
    expect(formatText(declared)).toMatch(/^faithful PASS clean · 100% match/);
    // Declaring another kind leaves the colour fault and its cost in place.
    const other = run([{ kind: 'text', match: 'Book now', reason: 'r', owner: 'o' }]);
    expect(other.score).toBe(undeclared.score);
    expect(other.pass).toBe(false);
  });

  it('conformity: a declared copy finding gives back its share of the score', () => {
    const inv = { colors: [], fontSizes: [], fontFamilies: [], radii: [], texts: ['Book now', 'Pay'] };
    const r = checkConformity(inv, screen([text('a', 'Book now', 0, 0)]), DEFAULT_CONFIG);
    expect(r.score).toBe(75);
    const before = r.findings;
    r.findings = applyDeviations(before, [{ match: 'Pay', reason: 'removed', owner: 'pm' }], '2026-11-17');
    rescoreDeclared(r, new Set(before));
    expect(r.score).toBe(100);
  });

  it('every entry must say what, why and who', () => {
    expect(() => parseDeviations({ deviations: [{ match: 'x', reason: '', owner: 'me' }] })).toThrow(
      /entry 1 needs a "reason"/,
    );
    expect(() => parseDeviations({ nope: 1 })).toThrow(/expected/);
  });
});
