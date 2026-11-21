# Faithful — handoff

State on 17 Nov 2026, for whoever continues this (a person or an agent). `README.md` says what
Faithful is; `AGENTS.md` says how to work on it; this file is what is done, what is not, and
what to do next, in order.

## Where it stands

- **Code:** `main` on GitHub at [appadmin-oss/faithful](https://github.com/appadmin-oss/faithful).
  Apache-2.0, copyright 2026 Afrovanguard (`LICENSE`, `NOTICE`).
- **Health:** `pnpm install && pnpm check` → lint clean, build, 130 tests, selftest — all green.
  Node 22.12+ and any Chromium (`node packages/cli/dist/bin.js doctor` says which it found).
- **Not published to npm.** The scope `@faithful` must be created on npmjs.com first. The
  unscoped name `faithful` belongs to an unrelated package: never tell anyone to run
  `npx faithful`; it is always `npx @faithful/cli` (a test enforces this in every skill).
- **Suggested GitHub description:** "Prove UI work is right before calling it done. Verify a
  build against its design, audit any page for layout faults and AI-design slop, and check a
  refactor or redesign kept every feature. CLI, MCP server and Agent Skills for coding
  agents." Topics: design-verification, visual-regression, ai-agents, mcp, claude-code,
  accessibility, playwright, design-tokens, refactoring, ui-testing.

## What works

| Piece | What it does | Proven by |
|---|---|---|
| `verify <design> --build <url\|file>` | Build vs design: missing/extra elements, copy, size, position relative to neighbours (a re-centred stack blames the element that changed), type, colour (CIEDE2000), the font actually drawn, targets; faults the design has too are notes | `packages/core/test/compare.test.ts`; `fixtures/pricing/` (faulty build fails, identical passes); 24 boards of a real Claude Design handoff rendered without `support.js` |
| Advance, don't copy | A departure that FIXES a WCAG fault (contrast crossing 4.5:1 / 3:1, a control grown past the target) is `improved`, a note | `packages/core/test/advance.test.ts` |
| `faithful.deviations.json` | Intended changes with reason, owner, expiry; covered findings become notes; expired entries cover nothing; stale entries are reported; a bad entry is exit 2 | `advance.test.ts`, `packages/cli/test/bin.test.ts` |
| `audit <url\|file>` | A page with no design, at 375 and 1440: clipped/overlapping/covered text, sideways scroll, broken images, script errors, failed requests, unrendered values, lorem/dummy data, invisible content, readability, small targets, too many sizes, wording, AI-slop tells scored by co-occurrence | `fixtures/audit/slop.html` (every planted fault, once) and `clean.html` (nothing); `packages/core/test/audit.test.ts` |
| `parity --before <a> --after <b>` | Refactor/redesign: every link, button, form field name, landmark, route still there; looks ignored; renames flagged; self-check plants a loss before trusting itself | `fixtures/parity/` (a re-skin passes, four planted losses caught); `packages/core/test/parity.test.ts` |
| Six Agent Skills | `faithful`, `faithful-implement-design`, `faithful-ui-quality`, `faithful-safe-redesign`, `faithful-ui-copy`, `faithful-design-handoff` in `packages/cli/skills/`; installed by `init` (`--skills a,b` for a subset) | `packages/cli/test/skills.test.ts` (spec limits, a proving command, no `npx faithful`) |
| `outline`, `spec`, `explain`, `guard`, `selftest`, `formats`, `doctor`, `init` | See `README.md` | `packages/cli/test/bin.test.ts` |
| MCP server (`@faithful/mcp`) | Six tools: outline, verify, audit, parity, explain, guard | `packages/mcp/test/stdio.test.ts` (real stdio) |

Every detector was broken on purpose and its test watched to fail. Keep doing that
(`AGENTS.md`). Exit codes: 0 pass, 1 fail, 2 bad call.

## How effective it is, and how it compares

**Measured so far** (planted faults only — they prove each detector works, not how it does on
real sites): `verify` caught 6/6 faults planted in a real Claude Design board, 0 false alarms on
an identical copy, and rendered 24 real boards (20/24 page heights match the designer's own
report). `audit` caught every planted fault once, 0 on a clean page. `parity` caught 4/4
planted losses, 0 on a full re-skin. Each check was also broken on purpose to see its test fail.

**Measured on a real build (21 Nov 2026).** Faithful was used to port and check a real
six-page Claude Design handoff (MAM Academy, PHP; 5 content pages + a 10-screen application).
- *verify, planted faults:* 18 realistic faults planted one at a time into the finished pages
  (copy, case, colour ΔE 5 and 18, background, font family/size/weight, letter-spacing,
  line-height, radius, a missing item, an extra badge, swapped rows, a 40px section shift, a
  grid gap, a hidden badge, a shrunk target): **18/18 caught**, and a 2px nudge correctly not
  reported. Three of the planter's own first attempts did not change the page (an
  `aria-label`-only copy edit, a swap inside a hidden menu, a `margin-top` overridden by the
  element's own `margin`); Faithful's silence on those was right.
- *verify, false alarms on a correct build:* before this change every page scored ~80% with
  nothing left to fix, and could never PASS. Causes, all fixed below: the design runtime's
  page-sized root wrapper counted as missing content; declared deviations never credited;
  nested equal boxes paired crosswise; a removed caption paired with a footer link five
  screens away; text of `hidden` children read as copy. After: all six pages PASS, 94–99%
  measured, 99–100% with declared deviations credited.
- *parity:* on the old vs new site, 262 "lost" errors before the duplicate-link fix, 139 after.
  The 139 are true per-page losses (an accessibility toolbar, a cookie notice, a slideshow, 16
  deep links), so the remaining number is the signal, not noise. It cannot tell a dead form
  (one posting to a page that ignores it) from a live one.
- *audit:* one false "overlap" on wrapped inline text, fixed; the planted faults still found.
- *Naming, not detection, is the weak spot:* swapped rows report as "position", letter-spacing
  and line-height as "size", a hidden badge as 6 findings. Root-cause naming is the next work.

**Not measured:** recall and false-alarm rate on many real sites. Estimates — parity high; verify
medium-high; audit's mechanical faults medium-high; the slop score unknown (peer tools report
5–10% false alarms, and audit has no contrast check yet).

**Against popular tools** (judgement, out of 10; Fit = covers Faithful's job, Proof = maturity
and measured accuracy, Agent = output usable by a coding agent): Faithful Fit 8, Proof 2–3,
Agent 9. Every category has a stronger specialist — axe-core and Lighthouse (accessibility,
Proof 10), Meticulous (refactor replay), Applitools/Percy/Chromatic (visual, paid),
Impeccable and ai-design-checker (slop) — and none combines design→build checking, a no-design
audit and redesign parity with agent-first output. The edge is the combination; the gap is
PROOF, not features.

## Design readers

Claude Design `.dc.html` (with or without `support.js`), HTML/URLs, Figma REST JSON, Faithful
specs, DTCG / CSS custom properties / Tailwind `@theme` tokens, DESIGN.md, copy decks, images.

**Not read yet: the current Claude Design format.** Claude Design moved into Claude itself (the
standalone site closes 14 Dec 2026). A design artifact is `project/canvas.json` (`"v": 3`, a
`boards` map of `<file>.dc.html → {x, y, w, h, title, expand: "fill", is_interactive}`) over
ordinary `.dc.html` boards; a design system is `project/design-system.json` + `tokens.json`
whose tokens are `{name, value, usage}` lists with per-theme values — the DTCG reader cannot
read that shape. Confirmed against a public MIT-licensed sample (Solar-Analytics-Dashboard,
`docs/design/v3/boards/canvas.json`).

## Next, in order

0. **Name the root cause** where detection is right but the label is not: letter-spacing and
   line-height changes reported as `size`, swapped siblings as two `position`s, one hidden
   element as several findings (see the MAM measurement above).

The order is set by the gaps above: proof first, then reuse where a specialist is stronger,
then breadth.

1. **Publish to npm** once the `@faithful` scope exists; set the GitHub description and topics.
   Nothing is used until it can be installed.
2. **Measure the slop score** against Adrian Krebs' `ai-design-checker` labelled set (MIT, 165
   sites, `npm run eval`): precision and recall, printed in the README. Re-measure after every
   rule change. UICrit (3,059 critiques; licence unverified) next.
3. **Run axe-core inside `audit`** (`@axe-core/playwright`, MPL-2.0; enable the `wcag22aa` tag
   or `target-size` stays off). Treat its "needs review" as review items, not passes. This
   alone closes most of the accessibility gap with the leaders.
4. **Text contrast in `audit` (WCAG 1.4.3)** — the commonest failure in AI-built sites. Walk
   ancestors for the background; text over an image or gradient is "cannot determine", never a
   pass. Then a dark-mode pass when the CSS has `prefers-color-scheme`.
5. **Measure parity on one real redesign** (the owner's NextGenGen update is the natural case):
   before/after URLs, every finding checked by hand, false alarms fixed with a test each.
6. **Canvas reader** (`packages/adapters`): one screen per board at its own `w` (height 900, or
   844 under 600px, for `expand: "fill"`; else `h`), titled from `title`; `verify --screen <id>`,
   stopping with the list of ids when several boards and no filter. Add the design-system
   tokens reader (`{name, value, usage}` lists, per-theme values) beside it.
7. **Verify match levels**, after Applitools: `--match strict|layout|ignore-colors`, so a
   deliberate restyle can be checked for layout alone.
8. **Audit tuning from the community research:**
   - side-stripe borders only on rows of 3+ sibling cards (today any box — `sideStripes`);
   - dead links (`href="#"`, `javascript:void(0)`), internal links that 404, missing `#id`s;
   - scaffold leftovers ("React App" / "Vite + React + TS" titles, default favicons, missing or
     duplicate title/description); heading structure (no H1, several, skipped levels);
   - agent text leaking into the UI ("TODO", "mock data", "(replace with …)", "Your Company");
     placeholder avatar hosts (dicebear, pravatar, randomuser, ui-avatars), `555-` numbers;
   - hover effects on things that are not clickable; visible focus (Tab walk + screenshot diff).
   - Keep the do-not-flag list in `faithful-ui-quality`.
9. **More "advance" credits:** line length back under 75 characters, spacing moved onto the
   scale, a value moved TOWARDS a design token.
10. **Parity, next signals:** network-contract parity (Playwright `recordHar`; method + path
    template + JSON key shape) and journey replay — record role/name scripts on BEFORE, lock and
    hash them before the agent starts, replay on AFTER (Meticulous is the bar here).
11. **Fixing help for agents:** a cropped screenshot per finding, the winning CSS rule's file
    and line (CDP `CSS.getMatchedStylesForNode` + source maps), forced hover/focus states.
12. **The 24 public handoff samples** the research found (several unlicensed — local testing
    only); running them executes strangers' page scripts, so it needs the owner's go-ahead.
13. **Modularity**, delegated: an optional adapter running madge (MIT), knip (ISC) and jscpd
    (MIT), failing only on regressions between BEFORE and AFTER.

## Things that will bite you

- `faithful.config.json`, `faithful.baseline.json` and `faithful.deviations.json` are the
  project's decisions. No MCP tool writes them, on purpose: a verifier the agent can loosen is
  no verifier.
- The page probes (`dc-runtime.ts`, `audit-probe.ts`, `extract.ts`) are serialised with
  `Function#toString`: no imports at runtime, no helpers from outside the function.
- Editing TypeScript through a Python heredoc: use raw strings (`r"""…"""`). A `\b` in a normal
  Python string becomes a backspace character and silently breaks every regex it lands in;
  `grep -rlP '\x08' packages` finds it.
- Never put a client's private design copy in tests, fixtures or the README.
- `KINDS` (`packages/core/src/findings.ts`) is a public vocabulary: add, never rename.
- The compact report has a token ceiling test; detail belongs behind `explain`.
- The skills are the single copy in `packages/cli/skills/`; the npm package ships that folder.

## Research behind it

`docs/research/agentic-tools.md` (what makes agent tools effective). The later research —
slop tells and their detectors, UX checks beyond axe, community complaints about AI-built UIs,
refactor-parity practice — is summarised in the plan above; its main sources: anthropics/skills
`frontend-design`, impeccable.style (Apache-2.0), ai-design-checker (MIT), pixelslop
(Apache-2.0), Vercel Web Interface Guidelines (MIT), Design2Code (arXiv 2403.03163), Playwright
ARIA snapshots, Anthropic's "AI code migration" (build a judge that passes on the original and
fails on planted breaks), WCAG 2.2.
