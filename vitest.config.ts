import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    testTimeout: 60_000,
    coverage: { provider: 'v8', include: ['packages/*/src/**'], thresholds: { lines: 85, branches: 80 } },
  },
});
