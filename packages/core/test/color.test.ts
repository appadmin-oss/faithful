import { describe, expect, it } from 'vitest';
import { contrastRatio, deltaE, deltaE2000Lab, parseColor, toHex } from '../src/color.js';

describe('CIEDE2000', () => {
  // Sharma, Wu & Dalal (2005), supplementary test data.
  const pairs: Array<[[number, number, number], [number, number, number], number]> = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
    [[50, 2.5, 0], [56, -27, -3], 31.903],
    [[50, 2.5, 0], [58, 24, 15], 19.4535],
    [[50, 2.5, 0], [50, 3.1736, 0.5854], 1.0],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  it.each(pairs)('%j vs %j = %d', (a, b, want) => {
    const got = deltaE2000Lab({ L: a[0], a: a[1], b: a[2] }, { L: b[0], a: b[1], b: b[2] });
    expect(got).toBeCloseTo(want, 3);
    // symmetric
    expect(deltaE2000Lab({ L: b[0], a: b[1], b: b[2] }, { L: a[0], a: a[1], b: a[2] })).toBeCloseTo(want, 3);
  });
  it('is zero for the same colour written differently', () => {
    expect(deltaE('#10292c', 'rgb(16, 41, 44)')).toBeCloseTo(0, 6);
    expect(deltaE('white', 'hsl(0 0% 100%)')).toBeCloseTo(0, 6);
  });
  it('returns null when either side is not a colour', () => {
    expect(deltaE('var(--x)', '#fff')).toBeNull();
    expect(deltaE(undefined, '#fff')).toBeNull();
  });
});

describe('parseColor', () => {
  it.each([
    ['#abc', '#aabbcc'],
    ['#AABBCCDD', '#aabbcc'],
    ['rgb(1,2,3)', '#010203'],
    ['rgb(1 2 3 / 50%)', '#010203'],
    ['rgba(255, 0, 0, 0.5)', '#ff0000'],
    ['hsl(120, 100%, 25%)', '#008000'],
    ['navy', '#000080'],
  ])('%s', (input, hex) => {
    const c = parseColor(input);
    expect(c).not.toBeNull();
    expect(toHex(c as NonNullable<typeof c>)).toBe(hex);
  });
  it('reads alpha', () => {
    expect(parseColor('rgb(1 2 3 / 50%)')?.a).toBe(0.5);
    expect(parseColor('transparent')?.a).toBe(0);
  });
  it.each(['', 'currentColor', 'var(--a)', '#12', 'rgb(1,2)', 'linear-gradient(red, blue)'])('rejects %j', (s) => {
    expect(parseColor(s)).toBeNull();
  });
});

describe('contrast', () => {
  it('black on white is 21', () => {
    expect(contrastRatio(parseColor('#000') as never, parseColor('#fff') as never)).toBeCloseTo(21, 5);
  });
  it('matches the WCAG reference for #767676 on white (4.54)', () => {
    expect(contrastRatio(parseColor('#767676') as never, parseColor('#fff') as never)).toBeCloseTo(4.54, 2);
  });
});
