import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain ES module script, run as-is by `pnpm bench`.
import { PRECISION_FLOOR, runBench } from '../../../scripts/bench.mjs';

describe('the labelled benchmark (fixtures/bench)', () => {
  it('finds every planted fault, raises no false alarm, and leaves every known-good page clean', async () => {
    const b = await runBench();
    const why = b.rows
      .filter((r: { misses: string[]; alarms: string[] }) => r.misses.length || r.alarms.length)
      .map(
        (r: { file: string; misses: string[]; alarms: string[] }) => `${r.file}: missed ${r.misses} alarms ${r.alarms}`,
      );
    expect(why).toEqual([]);
    expect(b.recall).toBe(1);
    expect(b.precision).toBeGreaterThanOrEqual(PRECISION_FLOOR);
    expect(b.cleanPass).toBe(b.cleanPages);
  }, 600_000);
});
