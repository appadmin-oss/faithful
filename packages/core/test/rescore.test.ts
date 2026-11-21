import { describe, expect, it } from 'vitest';
import { compareScreens } from '../src/compare.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { applyDeviations, rescore } from '../src/deviations.js';
import { box, screen, text } from './helpers.js';

const cfg = DEFAULT_CONFIG;
const design = () => [
  box('card', 100, 100, 600, 400),
  text('h', 'Apply for [INTAKE]', 120, 120, 300, 32),
  text('p', 'Fees per term', 120, 300, 300, 24),
];

function run(build: ReturnType<typeof design>, devs: Parameters<typeof applyDeviations>[1]) {
  const r = compareScreens(screen(design()), screen(build), cfg);
  return rescore({ ...r, findings: applyDeviations(r.findings, devs) });
}

describe('rescore: a declared difference stops costing score', () => {
  const filled = () => design().map((e) => (e.id === 'h' ? { ...e, text: 'Apply for TONI 2027' } : e));
  const dev = { kind: 'text', match: '[INTAKE]', reason: 'filled from the calendar', owner: 'design' };

  it('a build whose only difference is declared scores as matched, and keeps the measured figure', () => {
    const r = run(filled(), [dev]);
    expect(r.score).toBe(100);
    expect(r.measured).toBeLessThan(100);
  });

  it('an undeclared difference still costs exactly what it did', () => {
    const r = run(filled(), []);
    expect(r.score).toBe(r.measured);
    expect(r.score).toBeLessThan(100);
  });

  it('a declared missing element gives its area back to coverage', () => {
    const noCard = design().filter((e) => e.id !== 'card');
    const open = run(noCard, []);
    const declared = run(noCard, [
      { kind: 'missing', match: 'box at 100,100', reason: 'dropped on purpose', owner: 'design' },
    ]);
    expect(declared.score).toBeGreaterThan(open.score);
  });
});
