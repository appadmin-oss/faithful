import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
      // Not measurable here, so not counted: code that runs where Node's V8 coverage cannot
      // see it. The page probes are serialised into Chromium and tested through it (the
      // browser tests); the CLI entry runs in a spawned process (bin.test.ts); barrels and
      // type-only files hold no statements worth a number.
      exclude: [
        'packages/browser/src/audit-probe.ts',
        'packages/browser/src/extract.ts',
        'packages/browser/src/motion.ts',
        'packages/browser/src/physics.ts',
        'packages/browser/src/stress.ts',
        'packages/adapters/src/dc-runtime.ts',
        'packages/*/src/bin.ts',
        'packages/*/src/index.ts',
        'packages/core/src/adapter.ts',
      ],
      // A ratchet at what is measured today (25 Nov 2026), not a wish: raise it as tests are
      // added, never lower it to let a change through.
      thresholds: { lines: 85, branches: 72 },
    },
  },
});
