import { describe, expect, it } from 'vitest';
import { assign } from '../src/assign.js';

function brute(cost: number[][]): number {
  const rows = cost.length;
  const cols = cost[0]?.length ?? 0;
  let best = Number.POSITIVE_INFINITY;
  const used = new Array<boolean>(cols).fill(false);
  const go = (i: number, sum: number, placed: number) => {
    if (i === rows) {
      if (placed === Math.min(rows, cols)) best = Math.min(best, sum);
      return;
    }
    if (rows - i > cols - placed) go(i + 1, sum, placed); // this row may be left over
    for (let j = 0; j < cols; j++) {
      if (used[j]) continue;
      used[j] = true;
      go(i + 1, sum + (cost[i]?.[j] ?? 0), placed + 1);
      used[j] = false;
    }
  };
  go(0, 0, 0);
  return best;
}

const total = (cost: number[][], a: number[]) => a.reduce((s, j, i) => s + (j >= 0 ? (cost[i]?.[j] ?? 0) : 0), 0);

describe('assign', () => {
  it('finds the optimum where greedy does not', () => {
    // Greedy takes (0,0)=1 then is forced to (1,1)=10: 11. Optimal is 2+2=4.
    const c = [
      [1, 2],
      [2, 10],
    ];
    const a = assign(c);
    expect(total(c, a)).toBe(4);
  });
  it('matches brute force on random rectangular matrices', () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let t = 0; t < 200; t++) {
      const r = 1 + Math.floor(rnd() * 6);
      const k = 1 + Math.floor(rnd() * 6);
      const c = Array.from({ length: r }, () => Array.from({ length: k }, () => Math.round(rnd() * 100) / 10));
      const a = assign(c);
      expect(new Set(a.filter((j) => j >= 0)).size).toBe(a.filter((j) => j >= 0).length);
      expect(a.filter((j) => j >= 0).length).toBe(Math.min(r, k));
      expect(total(c, a)).toBeCloseTo(brute(c), 6);
    }
  });
  it('handles empty input', () => {
    expect(assign([])).toEqual([]);
    expect(assign([[], []])).toEqual([-1, -1]);
  });
});
