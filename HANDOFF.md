# Faithful — handoff

State on 17 Nov 2026, for whoever continues this (a person or an agent). Read `README.md` for
what Faithful is and `AGENTS.md` for how to work on it; this file is what is done, what is
not, and what to do next, in order.

## Where it stands

`main` is on GitHub at `appadmin-oss/faithful`. To publish the packages, the npm scope
`@faithful` must be created on npmjs.com first (the unscoped name `faithful` belongs to someone
else — never tell anyone to run `npx faithful`).

```
pnpm install && pnpm check     # lint, build, 108 tests, selftest — all green
```

Node 22.12+, and any Chromium (`node packages/cli/dist/bin.js doctor` says which it found).

## What works

| Command | What it does | Proven by |
|---|---|---|
| `verify <design> --build <url\|file>` | Build vs design: missing/extra elements, copy, size, position relative to neighbours, type, colour (CIEDE2000), rendered font, targets; faults the design has too are notes | `packages/core/test/compare.test.ts`; `fixtures/pricing/` (faulty build fails 7E, identical passes); 24 boards of a real Claude Design handoff rendered without `support.js` |
| `audit <url\|file>` | A page with no design, at 375 and 1440: clipped/overlapping/covered text, sideways scroll, broken images, script errors, failed requests, unrendered values, lorem/dummy data, invisible content, readability, small targets, too many sizes, wording, AI-slop tells scored by co-occurrence | `fixtures/audit/slop.html` (every planted fault found, once) and `clean.html` (nothing found); `packages/core/test/audit.test.ts` |
| `parity --before <a> --after <b>` | Refactor/redesign: every link, button, form field, landmark, route still there; looks ignored; renames flagged; self-check plants a loss before trusting itself | `fixtures/parity/` (re-skin passes, four planted losses caught); `packages/core/test/parity.test.ts` |
| `outline`, `spec`, `explain`, `guard`, `selftest`, `formats`, `doctor`, `init` | See `README.md` | `packages/cli/test/bin.test.ts` |
| `faithful.deviations.json` | Intended changes, with reason, owner, expiry; covered findings become notes; stale entries reported | `packages/core/test/advance.test.ts`, `packages/cli/test/bin.test.ts` |
| MCP server (`@faithful/mcp`) | Six tools over the same API: outline, verify, audit, parity, explain, guard | `packages/mcp/test/stdio.test.ts` (real stdio) |

Every detector added since the first commit was broken on purpose and its test watched to
fail. Keep doing that (see `AGENTS.md`).

Exit codes: 0 pass, 1 fail, 2 bad call.

## Design readers

Claude Design `.dc.html` (with or without `support.js`), HTML/URLs, Figma REST JSON, Faithful
specs, DTCG / CSS custom properties / Tailwind `@theme` tokens, DESIGN.md, copy decks, images.

**Not read yet: the current Claude Design format.** Claude Design moved into Claude itself (the
standalone site closes 14 Dec 2026). A design artifact is `project/canvas.json` (`"v": 3`, a
`boards` map of `<file>.dc.html → {x, y, w, h, title, expand: "fill", is_interactive}`) over
ordinary `.dc.html` boards; a design system is `project/design-system.json` + `tokens.json`
whose tokens are `{name, value, usage}` lists with per-theme values — a DTCG reader cannot
read that shape. Confirmed against a public MIT-licensed sample (Solar-Analytics-Dashboard,
`docs/design/v3/boards/canvas.json`).

## Next, in order

1. **Publish to npm** (above).
2. **Canvas reader** (`packages/adapters`): one screen per board at its own `w` (height 900, or
   844 under 600px, for `expand: "fill"`; else `h`), titled from `title`. Then `verify` needs a
   `--screen <id>` filter: comparing every board against one build URL is meaningless, so with
   more than one board and no filter it must stop and list the ids. Add the design-system
   tokens reader beside it.
3. **"Advance, don't copy blindly" — done.** `verify` credits a departure that FIXES a WCAG
   fault (contrast crossing 4.5:1 / 3:1, a control grown past the target size) as `improved`,
   and `faithful.deviations.json` declares intended changes with a reason, an owner and an
   expiry (`packages/core/src/deviations.ts`). Next in this area: line length and spacing-scale
   improvements, and crediting a move TOWARDS a design token.
4. **Audit tuning from the community research** (most valuable first):
   - **Text contrast (WCAG 1.4.3)** — the commonest failure in AI-built sites and NOT checked
     yet. Walk ancestors for the background; text over an image or gradient is "cannot
     determine", never a pass.
   - **Side-stripe borders: only on rows of 3+ sibling cards.** On callouts and blockquotes it
     is a normal design; today it fires on any box (`audit-probe.ts`, `sideStripes`).
   - Dead links (`href="#"`, `javascript:void(0)`), internal links that 404, `#id` targets
     that do not exist.
   - Scaffold leftovers: titles "React App" / "Vite + React + TS" / "Create Next App", default
     `vite.svg`/`next.svg` favicon, missing or duplicate title/description.
   - Heading structure: no H1, several H1s, skipped levels.
   - Agent text leaking into the UI: "TODO", "mock data", "(replace with …)", "Your Company".
   - Placeholder avatar hosts (dicebear, pravatar, randomuser, ui-avatars), `555-` numbers.
   - Hover effects on things that are not clickable; visible focus (Tab walk + screenshot
     diff); dark-mode contrast pass (only when the CSS has `prefers-color-scheme`).
   - Do-not-flag list, from practitioners: Inter/Geist alone, brand purple alone, glass on a
     sticky header or modal, emoji in consumer apps, em dashes, dark-only products (judge their
     contrast, not their darkness), pre-2023 template sites.
5. **Validate the slop score against labelled data** before calling it accurate: Adrian
   Krebs' `ai-design-checker` (MIT) ships 165 labelled sites (`npm run eval`); UICrit (licence
   unverified) has 3,059 critiques. Report precision and recall in the README.
6. **Parity, next signals:** network-contract parity (Playwright `recordHar`, diff method +
   path template + JSON key shape), and journey replay — record a few role/name scripts on
   BEFORE, lock and hash them before the agent starts (agents regenerate snapshots to pass),
   replay on AFTER.
7. **Fixing help for agents:** a cropped screenshot per finding, the winning CSS rule's file and
   line (CDP `CSS.getMatchedStylesForNode` + source maps), forced hover/focus states.
8. **The 24 public handoff samples** the research found (formats, licences and paths are in the
   research notes in the session; several have no licence — local testing only). Running them
   executes strangers' page scripts in the headless browser, so it needs the owner's go-ahead.
9. **Modularity** (the owner's "clean modular codebase" point) is better delegated than rebuilt:
   an optional adapter that runs madge (MIT) for cycles, knip (ISC) for unused exports, jscpd
   (MIT) for duplication, and fails only on regressions between BEFORE and AFTER.

## Things that will bite you

- `faithful.config.json` and `faithful.baseline.json` are the project's decisions. No MCP tool
  writes them, on purpose: a verifier the agent can loosen is no verifier.
- The page probes (`dc-runtime.ts`, `audit-probe.ts`, `extract.ts`) are serialised with
  `Function#toString`: no imports at runtime, no helpers from outside the function.
- Editing TypeScript through a Python heredoc: use raw strings (`r"""…"""`). A `\b` in a normal
  Python string becomes a backspace character and silently breaks every regex it lands in —
  that happened once here; `grep -rlP '\x08' packages` finds it.
- Never put private design copy in tests, fixtures or the README. The first README example
  quoted an unreleased client design; it was replaced with `fixtures/pricing/`.
- `KINDS` (`packages/core/src/findings.ts`) is a public vocabulary: add, never rename.
- The compact report has a token ceiling test; detail belongs behind `explain`.

## Research behind it

`docs/research/agentic-tools.md` (what makes agent tools effective). The later research —
slop tells and their detectors, UX checks beyond axe, community complaints about AI-built UIs,
refactor parity practice — is summarised in item 4–9 above; its main sources:
anthropics/skills `frontend-design`, impeccable.style (Apache-2.0), ai-design-checker (MIT),
pixelslop (Apache-2.0), Vercel Web Interface Guidelines (MIT), Design2Code (arXiv 2403.03163),
Playwright ARIA snapshots, Anthropic's "AI code migration" (build a judge that passes on the
original and fails on planted breaks), WCAG 2.2.
