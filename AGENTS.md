# Working on Faithful

Faithful's verdict is only worth something if it can be trusted, in both directions: it must
catch real faults and must not report correct code. Read `CONTRIBUTING.md` first.

- Build and test: `pnpm check` (lint, build, test, selftest). Single package: `npx vitest run packages/core`.
- After editing source, rebuild before running the CLI: `npx tsc -b packages/cli packages/mcp`.
- **Every new check or excusal needs a test that fails without it.** Break the code, run the
  test, restore. When excusing a case, add the test proving the real fault of the same shape
  is still reported.
- The compact report is held under a token ceiling (`packages/core/test/report.test.ts`).
  Detail goes behind `faithful explain`, never into the default output.
- `KINDS` in `packages/core/src/findings.ts` is a public vocabulary: never rename a kind.
- The CLI and the MCP server are thin shells over `packages/cli/src/api.ts`. Put logic there,
  never in only one of them.
- In docs and agent-facing text, spell the command `npx @faithful/cli`, never `npx faithful`
  (the unscoped npm name is somebody else's package).
- No new runtime dependency without discussion.
