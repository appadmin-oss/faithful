/**
 * Minimum-cost assignment (the Hungarian / Kuhn–Munkres algorithm, O(n³)).
 *
 * Used to pair design elements with built ones so that each design element is matched at most
 * once and the total mismatch is smallest — a greedy "closest first" pairing steals a good
 * match for an early element and leaves a later one stranded, which then reads as missing.
 */

/**
 * Solve a rectangular cost matrix (rows × cols). Returns, for each row, the column it is
 * assigned to, or -1 when there are more rows than columns and it was left over.
 */
export function assign(cost: number[][]): number[] {
  const rows = cost.length;
  if (rows === 0) return [];
  const cols = cost[0]?.length ?? 0;
  if (cols === 0) return new Array(rows).fill(-1);
  const n = Math.max(rows, cols);
  // Pad to square; padded cells cost 0 so they absorb the leftovers without biasing real pairs.
  const a: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i < rows && j < cols ? (cost[i]?.[j] ?? 0) : 0)),
  );
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0); // p[j] = row matched to column j (1-based)
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(INF);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0] as number;
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = (a[i0 - 1]?.[j - 1] as number) - (u[i0] as number) - (v[j] as number);
        if (cur < (minv[j] as number)) {
          minv[j] = cur;
          way[j] = j0;
        }
        if ((minv[j] as number) < delta) {
          delta = minv[j] as number;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j] as number] = (u[p[j] as number] as number) + delta;
          v[j] = (v[j] as number) - delta;
        } else {
          minv[j] = (minv[j] as number) - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0] as number;
      p[j0] = p[j1] as number;
      j0 = j1;
    } while (j0 !== 0);
  }
  const out = new Array<number>(rows).fill(-1);
  for (let j = 1; j <= n; j++) {
    const i = (p[j] as number) - 1;
    if (i >= 0 && i < rows && j - 1 < cols) out[i] = j - 1;
  }
  return out;
}
