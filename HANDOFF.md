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

1. **Publish to npm** once the `@faithful` scope exists; set the GitHub description and topics.
2. **Canvas reader** (`packages/adapters`): one screen per board at its own `w` (height 900, or
   844 under 600px, for `expand: "fill"`; else `h`), titled from `title`. `verify` then needs
   `--screen <id>`: with several boards and no filter it must stop and list the ids. Add the
   design-system tokens reader beside it.
3. **Audit tuning from the community research** (most valuable first):
   - **Text contrast (WCAG 1.4.3)** — the commonest failure in AI-built sites, NOT checked by
     `audit` yet (`verify` uses contrast only to credit improvements). Walk ancestors for the
     background; text over an image or gradient is "cannot determine", never a pass.
   - **Side-stripe borders: only on rows of 3+ sibling cards.** On callouts and blockquotes it
     is a normal design; today it fires on any box (`audit-probe.ts`, `sideStripes`).
   - Dead links (`href="#"`, `javascript:void(0)`), internal links that 404, missing `#id`
     targets.
   - Scaffold leftovers: titles "React App" / "Vite + React + TS" / "Create Next App", default
     favicons, missing or duplicate title/description.
   - Heading structure: no H1, several H1s, skipped levels.
   - Agent text leaking into the UI: "TODO", "mock data", "(replace with …)", "Your Company".
   - Placeholder avatar hosts (dicebear, pravatar, randomuser, ui-avatars), `555-` numbers.
   - Hover effects on things that are not clickable; visible focus (Tab walk + screenshot
     diff); dark-mode contrast (only when the CSS has `prefers-color-scheme`).
   - Keep the do-not-flag list (in `faithful-ui-quality`): Inter/Geist alone, brand purple
     alone, glass on a sticky header or modal, emoji in consumer apps, em dashes, dark-only
     products, pre-2023 template sites.
4. **Validate the slop score against labelled data** before calling it accurate: Adrian Krebs'
   `ai-design-checker` (MIT) ships 165 labelled sites; UICrit (licence unverified) has 3,059
   critiques. Put precision and recall in the README.
5. **More "advance" credits:** line length back under 75 characters, spacing moved onto the
   scale, a value moved TOWARDS a design token.
6. **Parity, next signals:** network-contract parity (Playwright `recordHar`; diff method +
   path template + JSON key shape) and journey replay — record a few role/name scripts on
   BEFORE, lock and hash them before the agent starts (agents regenerate snapshots to pass),
   replay on AFTER.
7. **Fixing help for agents:** a cropped screenshot per finding, the winning CSS rule's file
   and line (CDP `CSS.getMatchedStylesForNode` + source maps), forced hover/focus states.
8. **The 24 public handoff samples** the research found (several unlicensed — local testing
   only). Running them executes strangers' page scripts in the headless browser, so it needs
   the owner's go-ahead.
9. **Modularity**, delegated rather than rebuilt: an optional adapter running madge (MIT),
   knip (ISC) and jscpd (MIT), failing only on regressions between BEFORE and AFTER.

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
refactor-parity practice — is summarised in items 3–9; its main sources: anthropics/skills
`frontend-design`, impeccable.style (Apache-2.0), ai-design-checker (MIT), pixelslop
(Apache-2.0), Vercel Web Interface Guidelines (MIT), Design2Code (arXiv 2403.03163), Playwright
ARIA snapshots, Anthropic's "AI code migration" (build a judge that passes on the original and
fails on planted breaks), WCAG 2.2.
