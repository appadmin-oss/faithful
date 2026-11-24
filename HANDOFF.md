# Faithful — handoff

State on 20 Nov 2026, for whoever continues this (a person or an agent). `README.md` says what
Faithful is; `AGENTS.md` says how to work on it; this file is what is done, what is not, and
what to do next, in order.

## Where it stands

- **Code:** `main` on GitHub at [appadmin-oss/faithful](https://github.com/appadmin-oss/faithful).
  Apache-2.0, copyright 2026 Afrovanguard (`LICENSE`, `NOTICE`).
- **Health:** `pnpm install && pnpm check` → lint clean, build, 256 tests, selftest — all green.
  Node 22.12+ and any Chromium (`node packages/cli/dist/bin.js doctor` says which it found).
- **Not published to npm.** The scope `@faithful` must be created on npmjs.com first. The
  unscoped name `faithful` belongs to an unrelated package: never tell anyone to run
  `npx faithful`; it is always `npx @usefaithful/cli` (a test enforces this in every skill).
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
| `audit <url\|file>` | A page with no design, at 375 and 1440: axe-core's WCAG 2.2 A/AA rules (`a11y`), clipped/overlapping/covered text, sideways scroll, broken images, script errors, failed requests, unrendered values, lorem/dummy data, invisible content, readability, small targets, too many sizes, wording, AI-slop tells scored by co-occurrence; `--color-scheme light\|dark\|both`; `--stress expand,rtl,spacing` (pseudo-localised text, `dir=rtl`, WCAG 1.4.12 spacing; only the layout faults a pass adds) | `fixtures/audit/slop.html` (every planted fault, once) and `clean.html` (nothing); `packages/core/test/audit.test.ts` |
| `parity --before <a> --after <b>` | Refactor/redesign: every link, button, form field name, landmark, route still there; looks ignored; renames flagged; self-check plants a loss before trusting itself | `fixtures/parity/` (a re-skin passes, four planted losses caught); `packages/core/test/parity.test.ts` |
| Fourteen Agent Skills | `faithful`, `faithful-implement-design`, `faithful-ui-quality`, `faithful-safe-redesign`, `faithful-ui-copy`, `faithful-design-handoff`, `faithful-ui-states`, `faithful-responsive`, `faithful-accessible-forms`, `faithful-data-display`, `faithful-design-tokens`, `faithful-no-visual-change`, `faithful-dark-mode`, `faithful-i18n` in `packages/cli/skills/` (why: `docs/research/skills-2026-11.md`); installed by `init` (`--skills a,b` for a subset) | `packages/cli/test/skills.test.ts` (spec limits, a proving command, no `npx faithful`) |
| `outline`, `spec`, `explain`, `guard`, `selftest`, `formats`, `doctor`, `init` | See `README.md` | `packages/cli/test/bin.test.ts` |
| MCP server (`@usefaithful/mcp`) | Six tools: outline, verify, audit, parity, explain, guard | `packages/mcp/test/stdio.test.ts` (real stdio) |

Every detector was broken on purpose and its test watched to fail. Keep doing that
(`AGENTS.md`). Exit codes: 0 pass, 1 fail, 2 bad call.

## Resume here (20 Nov 2026, end of session)

Done and pushed: audit fixes, 14 skills, contrast + `--color-scheme`, `--stress`, axe-core,
canvas/design-system readers, `verify --screen`, TypeScript 7. Tests: 256, all green.
Next: HANDOFF item 8 (audit tuning) was started and stopped unfinished; its partial work is in
`git stash` on this machine only — restart it from the item 8 list below. Then items 1, 2, 5.

## Audit of 20 Nov 2026, fixed

An audit reproduced about 40 faults; every one below is fixed with a test watched to fail.
Verdicts that could lie: a missing element passing as a "split" of stray text; deviations whose
`expires` was not a date (covered forever) or whose 1-character `match` silenced everything;
declared findings still dragging the score; conformity copy matched as a page-wide substring;
`//` in `url(//cdn…)` hiding the rest of a CSS file from `guard`; parity false alarms on a file
vs its served copy, trailing slashes and query order; overlap measured on element boxes;
nav links excused as prose; © ™ counted as emoji. Runs that died: a `%` in any asset URL
crashed the process; a page looping after load hung forever; one stale browser path blocked
working ones. Hardening: page probes run in an isolated world, so a page cannot fake a clean
result; config and deviations are validated, bad JSON names its file; `file://` targets work.

Decision taken: target size follows WCAG 2.5.8 exactly — under 24px in either dimension is a
finding unless the 24px-circle spacing exception holds (`audit.ts`, one line to make stricter).
Open: findings with no element are declarable only with `kind` plus an 8+ character phrase.

## How effective it is, and how it compares

**Measured so far** (planted faults only — they prove each detector works, not how it does on
real sites): `verify` caught 6/6 faults planted in a real Claude Design board, 0 false alarms on
an identical copy, and rendered 24 real boards (20/24 page heights match the designer's own
report). `audit` caught every planted fault once, 0 on a clean page. `parity` caught 4/4
planted losses, 0 on a full re-skin. Each check was also broken on purpose to see its test fail.

**Not measured:** recall and false-alarm rate on real sites. Estimates — parity high; verify
medium-high; audit's mechanical faults medium-high; the slop score unknown (peer tools report
5–10% false alarms).

**Against popular tools** (judgement, out of 10; Fit = covers Faithful's job, Proof = maturity
and measured accuracy, Agent = output usable by a coding agent): Faithful Fit 8, Proof 2–3,
Agent 9. Every category has a stronger specialist — axe-core (now run inside `audit`) and Lighthouse (accessibility,
Proof 10), Meticulous (refactor replay), Applitools/Percy/Chromatic (visual, paid),
Impeccable and ai-design-checker (slop) — and none combines design→build checking, a no-design
audit and redesign parity with agent-first output. The edge is the combination; the gap is
PROOF, not features.

## Design readers

Claude Design `.dc.html` (with or without `support.js`), Claude Design canvases
(`project/canvas.json`, `"v": 3`) and design systems (`design-system.json` + `tokens.json`),
HTML/URLs, Figma REST JSON, Faithful specs, DTCG / CSS custom properties / Tailwind `@theme`
tokens, DESIGN.md, copy decks, images.

**Done 20 Nov 2026: the current Claude Design format.** Claude Design moved into Claude itself
(the standalone site closes 14 Dec 2026). A design artifact is `project/canvas.json` (`"v": 3`,
a `boards` map of `<file>.dc.html → {x, y, w, h, title, expand: "fill", is_interactive}`) over
ordinary `.dc.html` boards; `canvas.ts` reads each board through the dc-html reader at its own
`w` (`expand: "fill"` → 900 high, 844 under 600px; else `h`), id from the file, name from
`title`; boards are looked for beside the canvas, then beside `project/`. A missing board is a
warning; another `v` or a malformed board is a SpecError naming file and place. A design system
is `design-system.json` + `tokens.json`, `{name, value, usage}` lists with per-theme values;
`design-system.ts` reads it tolerantly (shape documented at the top of the file) into an
inventory with every theme's colours. Shape confirmed against a public MIT-licensed sample
(Solar-Analytics-Dashboard, `docs/design/v3/boards/canvas.json`); the tokens shape is inferred,
not confirmed against a real `tokens.json` — check one when available. Fixtures: `fixtures/canvas/`
(synthetic). Left: `x`/`y` and `is_interactive` are not read; every board is rendered even
with `--screen` (slow on a large canvas). Note: `verify` now stops (exit 2, listing ids) on ANY design
whose placed screens are different boards — a Figma export of several frames too — until
`--screen` picks one; one design at several viewports (`x@1440`, `x@390`) is unaffected.

## Next, in order

The order is set by the gaps above: proof first, then reuse where a specialist is stronger,
then breadth.

1. **Publish to npm** once the `@faithful` scope exists; set the GitHub description and topics.
   Nothing is used until it can be installed.
2. **Measure the slop score** against Adrian Krebs' `ai-design-checker` labelled set (MIT, 165
   sites, `npm run eval`): precision and recall, printed in the README. Re-measure after every
   rule change. UICrit (3,059 critiques; licence unverified) next.
3. ~~Run axe-core inside `audit`~~ — done 20 Nov 2026. Plain `axe-core` (^4.14.1, MPL-2.0,
   unmodified, a runtime dependency of `@usefaithful/browser`), evaluated in the probe's isolated
   world (`packages/browser/src/axe.ts`; a page cannot plant a fake `axe`), tags
   `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`, once per viewport and colour scheme, never
   in stress passes, bounded by the capture timeout. Mapped in `packages/core/src/audit.ts`
   (`axeFindings`): new kind `a11y`, one finding per rule (critical/serious E, moderate/minor
   W) with a count and the first element; the help URL is `Finding.help`, shown only by
   `explain`. `color-contrast` and `target-size` are dropped (`AXE_MEASURED_BY_FAITHFUL`:
   Faithful's own `contrast` and `target` report them). "Needs review" is one `a11y` note.
   axe failing or timing out is `W unmeasured`. Off with `--no-axe` or `audit.axe: false`,
   and the report's `reader:` line says so. No MCP switch, on purpose (an agent must not be
   able to loosen its own verifier). Left: iframes are not entered (`iframes: false`); one
   finding per rule means a second element failing the same rule is only counted; axe adds
   about a second per pass; the rule ids are axe's, not Faithful's vocabulary.
4. ~~Text contrast in `audit`~~ — done 20 Nov 2026, with `--color-scheme light|dark|both`.
   Left: text over images/gradients and overlapping boxes is "not judged" (no layer order
   yet); placeholders and pseudo-element text are not measured; logos are exempt by class name.
5. **Measure parity on one real redesign** (the owner's NextGenGen update is the natural case):
   before/after URLs, every finding checked by hand, false alarms fixed with a test each.
6. ~~**Canvas reader**~~ — done 20 Nov 2026: `canvas.json` boards as screens, `verify --screen`,
   the design-system tokens reader (see Design readers).
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
- Browser and CLI tests import `@usefaithful/core` from its built `dist`: after editing core,
  `npx tsc -b packages/core` before running them, or a break you planted is not seen.
- axe-core is evaluated as a prelude in the probe's isolated world (`inWorld(…, prelude)` in
  `capture.ts`); its in-page runner (`runAxe`) is serialised like the probes, so no imports.
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
