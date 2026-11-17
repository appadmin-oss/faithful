# Contributing to Faithful

Thank you for helping. Faithful's whole value is that its verdict can be trusted, so the rules
below are mostly about keeping it honest.

## Setup

```
pnpm install
pnpm check      # lint, build, test, selftest
```

You need Node 22.12+ and a Chromium (`node packages/cli/dist/bin.js doctor`).

## Rules for a change

1. **A new check ships with a test that fails without it.** Break the code, watch the test
   name the break, restore it. A check that has only ever been seen passing is not evidence.
2. **A false positive is a bug, as much as a missed fault.** An agent that is told to fix
   correct code learns to ignore the tool. When you excuse a case (a knock-on, a fault the
   design has too), also add the test proving a real fault of the same shape is still caught.
3. **Mind the token budget.** The compact report is held under a ceiling by
   `packages/core/test/report.test.ts`. Detail belongs behind `faithful explain`.
4. **Keep `KINDS` stable.** A renamed finding kind breaks every prompt that names it.
5. **No new runtime dependency without discussion.**

## Sign your commits (DCO)

Contributions are accepted under the [Developer Certificate of Origin](https://developercertificate.org/).
Sign off every commit:

```
git commit -s -m "Explain what changed and why"
```

which adds `Signed-off-by: Your Name <you@example.com>`, certifying that you wrote the change
or have the right to submit it under the Apache License 2.0.

## Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
