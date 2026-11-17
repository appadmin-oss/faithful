import type { Provenance } from '@faithful/spec';
import { describe, expect, it } from 'vitest';
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
    text: i % 2 ? `Built line number ${i} with other words` : e.text,
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
    expect(out).toContain(`+${r.findings.length - 8} more`);
    expect(tokens(JSON.stringify(formatCompact(r)))).toBeLessThan(600);
  });

  it('prints each fix sentence once per kind, not per finding', () => {
    const out = formatText(noisy(20), 20);
    expect(out.match(/Use the design copy exactly/g)).toHaveLength(1);
  });

  it('errors come before warnings', () => {
    const r = noisy(20);
    const sev = r.findings.map((f) => f.severity);
    expect(sev.indexOf('warn') === -1 || sev.lastIndexOf('error') < sev.indexOf('warn')).toBe(true);
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
