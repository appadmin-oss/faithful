import { describe, expect, it } from 'vitest';
import { binomialTail, fitSpacingGrid, fitTypeScale, hierarchyInversions, nearMissEdges } from '../src/design-sense.js';

describe('the type scale a page follows', () => {
  it('finds a major third from 16px and names the size that misses it, with the steps either side', () => {
    // 16 · 1.25ⁿ = 12.8, 16, 20, 25, 31.25, 39 — rounded as designers round them.
    const fit = fitTypeScale([
      [13, 10],
      [16, 120],
      [20, 30],
      [25, 12],
      [31, 6],
      [39, 2],
      [22, 3],
    ]);
    expect(fit?.name).toBe('major third');
    expect(fit?.base).toBe(16);
    expect(fit?.off).toEqual([{ size: 22, n: 3, below: 20, above: 25 }]);
  });

  it('the fix is a size the page already uses, never a computed decimal', () => {
    // GOV.UK-like tokens 16, 19, 24, 27, 36, 48 follow no single ratio; nothing is claimed.
    expect(
      fitTypeScale([
        [19, 200],
        [16, 40],
        [24, 20],
        [27, 10],
        [36, 6],
        [48, 3],
        [21, 3],
      ]),
    ).toBeNull();
  });

  it('a perfect fourth is not mistaken for a smaller ratio that also happens to fit', () => {
    // 16 · 1.333ⁿ = 21.3, 28.4, 37.9, 50.5
    const fit = fitTypeScale([
      [16, 100],
      [21, 20],
      [28, 10],
      [38, 5],
      [50, 2],
    ]);
    expect(fit?.name).toBe('perfect fourth');
    expect(fit?.off).toEqual([]);
  });

  it('sizes chosen by eye follow no scale, and nothing is claimed', () => {
    expect(
      fitTypeScale([
        [15, 50],
        [17, 40],
        [19, 30],
        [23, 20],
        [27, 10],
        [33, 5],
        [41, 4],
      ]),
    ).toBeNull();
  });
});

describe('the spacing grid a page counts in', () => {
  it('finds the 8px grid and names the value typed off it', () => {
    const fit = fitSpacingGrid([
      [8, 40],
      [16, 60],
      [24, 30],
      [32, 12],
      [48, 6],
      [13, 2, 'div.card'],
    ]);
    expect(fit?.unit).toBe(8);
    expect(fit?.off).toEqual([{ value: 13, n: 2, below: 12, above: 16, sel: 'div.card' }]);
  });

  it('a value used again and again is a decision, and 4px is an 8px grid’s half-step', () => {
    const fit = fitSpacingGrid([
      [8, 40],
      [16, 60],
      [24, 30],
      [32, 12],
      [4, 25],
      [6, 20, 'button'],
    ]);
    expect(fit?.unit).toBe(8);
    expect(fit?.off).toEqual([]);
  });

  it('a 4px grid is found when 8 does not cover it; hairlines are not spacing', () => {
    const fit = fitSpacingGrid([
      [4, 30],
      [12, 40],
      [20, 20],
      [8, 10],
      [28, 6],
      [1, 50],
    ]);
    expect(fit?.unit).toBe(4);
    expect(fit?.off).toEqual([]);
  });

  it('spacing with no common unit claims no grid', () => {
    expect(
      fitSpacingGrid([
        [7, 10],
        [11, 10],
        [13, 10],
        [17, 10],
        [19, 10],
        [23, 10],
      ]),
    ).toBeNull();
  });
});

describe('alignment', () => {
  const col = (x: number, n: number, y0 = 0) =>
    Array.from({ length: n }, (_, i) => ({ x, y: y0 + i * 40, h: 20, sel: `p:nth-of-type(${i + 1})` }));

  it('an edge 2px off the edge nine elements share is a slip, said with the edge it missed', () => {
    const out = nearMissEdges([...col(24, 9), { x: 26, y: 100, h: 20, sel: 'p.late' }]);
    expect(out).toEqual([{ sel: 'p.late', x: 26, to: 24, shared: 9, by: 2 }]);
  });

  it('a second column 16px in, an indent shared by several, and a far-away element are not slips', () => {
    expect(nearMissEdges([...col(24, 9), ...col(40, 5), { x: 27, y: 5000, h: 20, sel: 'footer p' }])).toEqual([]);
    expect(nearMissEdges([...col(24, 9), ...col(27, 3, 60)])).toEqual([]);
  });
});

describe('hierarchy', () => {
  it('a level drawn larger than the one above it reads out of order; a reasonable descent does not', () => {
    expect(
      hierarchyInversions([
        { level: 2, size: 24, sel: 'h2' },
        { level: 2, size: 24, sel: 'h2' },
        { level: 3, size: 30, sel: 'h3.big' },
      ]),
    ).toEqual([{ upper: 2, lower: 3, upperPx: 24, lowerPx: 30, sel: 'h3.big' }]);
    expect(
      hierarchyInversions([
        { level: 1, size: 40, sel: 'h1' },
        { level: 2, size: 28, sel: 'h2' },
        { level: 3, size: 20, sel: 'h3' },
        { level: 4, size: 20.5, sel: 'h4' },
      ]),
    ).toEqual([]);
  });
});

describe('a fit must beat chance', () => {
  it('four sizes, two on a dense scale by coincidence, claim no scale', () => {
    expect(
      fitTypeScale([
        [17, 100],
        [19, 4],
        [22.5, 1],
        [27, 2],
      ]),
    ).toBeNull();
  });
  it('the binomial tail is the textbook one', () => {
    expect(binomialTail(3, 2, 0.3)).toBeCloseTo(0.216, 3);
    expect(binomialTail(6, 5, 0.3)).toBeCloseTo(0.0109, 3);
    expect(binomialTail(4, 0, 0.3)).toBeCloseTo(1, 6);
  });
});

describe('a grid must beat chance', () => {
  it('a few values that happen to be even claim no 4px grid', () => {
    expect(
      fitSpacingGrid([
        [12, 10],
        [20, 8],
        [7, 1],
        [13, 1],
        [16, 3],
      ]),
    ).toBeNull();
  });
});

describe('a token list is not forced into a ratio', () => {
  it('a design system’s sizes (GitHub’s, as audited) claim no scale, rather than a major second that fits anything', () => {
    expect(
      fitTypeScale([
        [14, 100],
        [12, 20],
        [16, 30],
        [18, 10],
        [20, 8],
        [22, 4],
        [28, 4],
        [32, 3],
        [40, 2],
        [56, 1],
      ]),
    ).toBeNull();
  });
});
