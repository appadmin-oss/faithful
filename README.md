# Faithful

**Prove that what was built matches what was designed.** For coding agents, design agents and
the people reviewing their work.

A design is a specification: every colour, size, radius, string and state in it was decided.
Most "does it match the design?" checks are a person squinting at two screenshots, or an agent
saying it tried. Faithful renders both, pairs every element, and says exactly what differs, in
a few lines an agent can act on:

```
$ npx @usefaithful/cli verify design.html --build build.html --viewports 1440x900
faithful FAIL 7E 1W · 87% match · 1 note · placed · web/html
F1 E missing: text "Business" at 725,509 89×24 [div.plan:nth-of-type(3)>h2] @725,509 89×24
F2 E missing: text "Single sign-on and audit logs." at 725,551 225×20 [div.plan:nth-of-type(3)>p] @725,551 225×20
F3 E text: "Plans that grow with your team." → "Plans that grow with your company." [h1] @40,170 569×119
F4 E font-size "Plans that grow with your team.": 56px → 48px [h1] @40,170 569×119
F5 E size "Plans that grow with your team.": 535×128 → 569×119 [h1] @40,170 569×119
F6 E color "Plans that grow with your team.": rgb(16, 41, 44) → rgb(29, 78, 216) (ΔE 29.4) [h1] @40,170 569×119
F7 E position "Sign in": off by 90px × 0px from where its neighbours put it [a:nth-of-type(2)] @1258,20 52×24
F8 W missing: box at 700,484 310×130 [div.plan:nth-of-type(3)] @700,484 310×130
fix: missing → Add this element; the design has it and the build does not. | text → Use the design copy exactly. | …
```

That is `fixtures/pricing/` in this repository; run it yourself. The hero is vertically
centred, so the smaller heading moved the eyebrow above it, and that is not reported: it is
the heading's finding.

A faithful build is one line:

```
faithful PASS clean · 100% match · placed · web/html
```

> **Use `npx @usefaithful/cli`, never `npx faithful`.** The unscoped name on npm is an unrelated
> package; in a project without Faithful installed, the short form downloads and runs it.

## No design? Audit the page

```
$ npx @usefaithful/cli audit http://localhost:3000
```

Judges a page on its own, at a phone and a desktop width, and reports each fault once. With
no design to compare against, **the page is its own reference**: its menus must agree with its
headings, its values with each other, and its layout must hold at the reader's settings and
device, not only the author's.

**Each width is rendered as the device it stands for.** Under 768px is a phone, under 1024px a
tablet: touch and no hover, so the page's `(hover: none)` and `(pointer: coarse)` rules apply,
and a phone honours the page's viewport meta (without one it lays the page out 980px wide and
shrinks it, which is reported). A 390px desktop window is not a phone and shows the desktop
design. Override with `--viewports 1024x768:tablet` or `390x844:desktop`.

**Copy that narrates the interface** is named: a page whose headings are each explained by the
sentence under them ("This page shows your recent transactions"), a heading echoed in other
words, cards that all open "Easily…", footers that vouch "Every figure here is derived from the
ledger". One is a choice and only noted; the pattern is a warning and counts as a tell. Hints a
field points at, `<details>`, empty states and legal notices are never counted
(`docs/research/narration-and-physics-2026-11.md`). Elements that keep moving when the reader
asked for less motion are reported too.

Every audit also renders each page **with text alone at 200%** (as Android font scale and iOS
text size do; a robustness warning, since WCAG 1.4.4 is met by page zoom) and **at 320px
wide** (WCAG 1.4.10, an error), reporting only the clipped text, overlaps and sideways scroll
each adds, once even when both passes see it: a menu
that fits at the author's size and cuts off its last item for a reader with larger text is
the fault no screenshot shows. `--stress` adds more passes — `expand` (every string
pseudo-localised to a translation's length, 1.3–2×), `rtl`, `spacing` (WCAG 1.4.12) — and
`--stress none` turns them all off. `--color-scheme dark|both` renders with
`prefers-color-scheme` (`audit@375 dark`).

- **Faults a user cannot get past:** text cut off by its box or drawn over other text, a page
  that scrolls sideways on a phone, broken images, script errors, `undefined` /
  `[object Object]` / `{{ x }}` printed where a value should be, lorem ipsum.
- **Contrast (WCAG 1.4.3):** text under 4.5:1 (3:1 for 24px, or bold 18.66px) against the
  colour actually drawn behind it — alpha, stacked backgrounds and opacity composited. One
  finding per colour pair and size, with a count. Text over an image, gradient, video, filter
  or blend is "not judged" (one note), never a pass. In dark mode, a page with dark styles but
  no `color-scheme` is flagged for leaving native form controls light.
- **WCAG 2.2 A/AA, by axe-core:** [axe-core](https://github.com/dequelabs/axe-core) runs at
  every width and theme (not in stress passes) with the `wcag2a`, `wcag2aa`, `wcag21a`,
  `wcag21aa` and `wcag22aa` rules: missing form labels, image alt, button and link names,
  `<html lang>`, ARIA misuse and more. One finding per rule (`a11y`; critical/serious an error,
  moderate/minor a warning) with a count and the first element; `faithful explain` gives the
  rule's help page. `color-contrast` and `target-size` are left to Faithful's own `contrast`
  and `target` checks, so one fault is never two findings. What axe cannot decide ("needs
  review") is one note, never a pass. If axe cannot run, the run says so (`unmeasured`), never
  clean. `--no-axe`, or `"audit": { "axe": false }` in `faithful.config.json`, switches it off;
  the report then says the WCAG rules were unmeasured. axe does not enter iframes.
- **Reading:** lines longer than 75 characters, tight line height, small body text, targets
  under 24px, more than ten font sizes.
- **Wording:** links named "click here", a row of "Learn more" links to different places,
  "Submit" buttons, one action under two names (Sign in / Log in), headings mixing Title Case
  and sentence case, doubled words.
- **Navigation logic** — what no screenshot shows: one screen in the menus under two names
  ("Marking" and "Grade entry"), one name going to two places, the menu calling this page
  something its heading does not, a strip of a menu wider than `audit.navMax` (default 7), a
  page with no `h1`, skipped heading levels.
- **Consistency, with the page as its own reference:** a colour used once that is a hair
  (ΔE < 2.5) from one the page uses everywhere, 15px text among 16px, a 6px corner among 8px,
  a minority of buttons shaped unlike the rest. Only near-copies: an accent or a display size
  is a choice.
- **Left behind:** links that go nowhere (`#`, `javascript:`, a `#id` with no such id), notes
  an agent left for later (TODO, "mock data", "(replace with …)", Your Company, 555-01xx),
  a scaffold's title ("Vite + React + TS") or none, placeholder images and avatars.
- **The tells of generated UI:** gradient text, coloured glow, emoji as icons, a stripe down
  a row of cards, cards in cards, frosted glass, decoration stacked on one box, a pill above
  the headline, a label that only repeats its heading, copy that could describe any product.
  A technique is a choice: one tell alone is a note, never a warning, and a purple brand set
  in Inter is not flagged at all. Tells together are warnings, and several fail the page as
  "reads as generated".

`fixtures/audit/` holds a page with every fault planted and a plain, deliberate page that must
stay clean; both are run on every test.

## Refactoring or redesigning? Prove nothing was lost

```
$ npx @usefaithful/cli parity --before http://localhost:3000 --after http://localhost:3001
faithful FAIL 3E 2W · parity · parity@1
F1 E lost: link "Delete account" → /account/delete is gone
F2 E lost: field "email" (Email) is gone from the form; is it "emailAddress"? The server reads the name
F3 E changed: a form now sends to /subscribe, not /newsletter
F4 W lost: the contentinfo landmark is gone
F5 W renamed: link "My orders" is now "Your orders": confirm it is the same action
```

Compares what users can DO before and after a refactor or a complete redesign: every link and
button (by role, accessible name and target), every form (where it sends, how, and the field
names the server reads), landmarks, routes (two URLs are crawled one level, so a page that
404s after the change is caught) and new script errors. No pixels and no DOM structure are
compared, so a full re-skin raises nothing. Controls are matched across changed markup by
target, then name, then a close name; a rename is shown for confirmation, never passed
silently. Before trusting its answer it plants a loss in a copy of the old page and checks it
is caught; when it cannot be, the run says "inconclusive".

That is `fixtures/parity/`: a re-skin that passes, and the same re-skin with four planted
losses.

## What it reads

| Design | How |
|---|---|
| Claude Design handoffs (`.dc.html`) | Rendered with or without `support.js` and their data scripts: Faithful runs the component's own logic, or falls back to its static template and says so |
| Claude Design canvases (`project/canvas.json`, `"v": 3`) | One screen per `.dc.html` board at the board's own width (`expand: "fill"` boards are 900 high, 844 under 600px); a board not on disk is a reader warning. One build is one board: `verify --screen <id>` |
| Claude Design design systems (`design-system.json` + `tokens.json`) | `{name, value, usage}` lists, a value per theme (`{"light": …, "dark": …}`) or a type style; every theme's colours go in the inventory |
| HTML / JSX prototypes, dev servers, live URLs | Rendered in Chromium |
| Figma REST exports (`GET /v1/files/:key`) | Frames become screens, frame-relative |
| A Faithful spec (`*.faithful.json`) | Written by a design agent, or by `faithful spec` |
| Design tokens: DTCG JSON, CSS custom properties, Tailwind v4 `@theme` | An inventory: is every colour, size and radius in the build one the design has? |
| `DESIGN.md`, copy decks (`.txt`) | The same, from prose and from the copy |
| Reference images | Placed with a `.faithful.json` sidecar, indicative without one |

A design that can be placed (it has screens) is compared element by element at its own
viewport. One that cannot (tokens, a copy deck) is checked for **conformity**, and the result
says `(indicative)` so nobody reports it as a match.

A design of several different screens (a canvas of boards, a Figma file of pages) is several
pages, and one build is one of them: `verify` stops (exit 2) with the screen ids until
`--screen <id>` names one; `outline` lists them. One design at several `--viewports` is one
page and needs no `--screen`.

## What it checks

- **Coverage**: missing and extra elements; text split across elements or merged into one.
- **Copy**: exact strings, with capitalisation reported separately.
- **Position, relative to neighbours**: an element is judged against what places it (its
  container, the element above, the one to its left), so a taller header is ONE finding, not
  one per element below it. A stack that re-centres because one member changed height blames
  that member.
- **Size, type and colour**: font family (the face that actually rendered, not the one the CSS
  asked for), size, weight, line height, letter spacing; text and background colour by
  CIEDE2000; borders and radii.
- **Design sense, with no design file**: the page's own system is fitted, never imposed: a
  modular type scale (base · rⁿ) and a spacing grid (8 with its 4px half-step, 6, 5, 4), each
  claimed only when it beats chance (binomial test), and left edges four or more elements
  share. A value that misses the system by a little is named with the value to use ("13px
  spacing is off the 8px grid: use 12px or 16px"; "starts 3px right of the edge 9 elements
  share"); a heading drawn larger than the level above it is named; one note states the
  system so an agent adding to the page uses its numbers.
- **Form design, measured**: a field far wider than what goes in it (Baymard: size fields with a
  known length to that length; GOV.UK sizes inputs in characters), a form laid out in columns
  (Baymard and CXL: more skipped and misread fields, slower), a label nearer the field above
  than its own (Gestalt proximity, NN/g), and a unit only in the label. Collapsed sections are
  opened and judged too (the `open` pass), because a reader opens them.
- **Layout faults judged by what they are**: text cut off or overlapping inside a picture of
  UI is not a layout error, but a screen reader reading it and a keyboard tabbing into it is,
  once per picture; a frozen marquee, content hidden right now, a stacked deck, a heading over
  a copy of itself and a floating label are each said for what they are.
- **Motion, as declared**: each element's transitions and animations, CSS and scripted —
  which properties move, for how long, along which curve, after which delay, how many times. A
  design that moves where the build is still is an error.
- **Motion, as it happens** (`--physics`): both pages are watched coming in, frame by frame,
  and how each element moved is compared — distance, time to rest, curve, overshoot. A spring
  is fitted (stiffness and damping, as spring libraries take them), so "the design springs
  (overshoots 23%; stiffness ≈ 365, damping ≈ 16); the build stops dead" is a finding, not a
  feeling. Script-driven motion has no declaration; this is the only way to see it.
- **Touch targets** under the minimum.
- **Faults the design has too** are notes, not errors: you are not asked to fix the designer's
  12px button.

Findings come back root-cause first: missing, copy and size before the positions they move.

## How accurate it is

A verifier is worth what its verdicts are worth, in both directions. Two measures, both
reproducible:

**Live sites** (25 Nov 2026, `faithful audit <url>`, every pass on). Errors before and after
judging each layout fault by what it is (a picture of UI, a frozen marquee, an inactive slide,
a stacked deck, a layered heading, a floating label):

| Site | Errors before | Errors now | What remains |
|---|---|---|---|
| GOV.UK | 1 | **0** (pass) | — |
| Stripe | 20 | **1** | an axe rule: visible label text missing from the accessible name (×7) |
| Linear | 45 | **5** | a React hydration error, an unnamed button, a scroll region with no keyboard access, and (on the run that day) a missing title and lang |
| GitHub | 21 | **3** | a real sideways scroll at 320px; two overlaps in its trending cards, not yet confirmed either way |

Live pages change between runs; the counts are a measurement on that day, not a fixture.

**Labelled set** (`pnpm bench`, `fixtures/bench/`): known-good pages built from the very
patterns that caused the false alarms above, and pages with one planted fault each. **13 of
13 planted faults found, 0 false alarms, 5 of 5 known-good pages clean.** It runs in the test
suite and fails the build below 100% recall or 90% precision. Read it for what it is: the
same hands wrote the fixtures and the fixes, so it is a regression guard, not an independent
benchmark. Text enlarged *alone* to 200% (Android font scale, iOS text size) goes beyond
WCAG; those warnings are counted apart (3 on the known-good pages: a long word in a large
heading wider than a phone, fixed by `overflow-wrap: anywhere`).

## How it differs from visual-testing services

Visual-testing services (Percy, Chromatic, UI Verify) answer **"did it change since main?"**:
a pixel diff against a stored baseline, judged by a person or an AI model, in the cloud,
metered per screenshot. Faithful answers **"is it right?"**: against the design file, or with
no design against the page's own system and the standards, element by element, on your
machine, with rules you can read and a benchmark you can run. The two are complementary; a
baseline accepts a first build that is already wrong, and that is the case Faithful is for.
A critical comparison, with what Faithful has taken and still lacks:
`docs/research/ui-verify-and-the-field-2026-11.md`.

Pages behind a login (an admin console, a member's portal) are checked signed in with
`--storage-state session.json`: a Playwright storage-state file of cookies and localStorage,
as `npx playwright codegen --save-storage=session.json <url>` or any login script writes it.
Every page of the run opens with it; it is never written into a result.

Live data that should never be judged (a clock, prices, an ad slot) can be marked
`data-faithful-ignore`; it is left out of verify and audit on both sides.

## For agents

```
npx @usefaithful/cli init
```

writes `faithful.config.json`, fourteen Agent Skills under `.agents/skills/` (see [Skills](#skills)),
and a short block in `AGENTS.md`, because a skill does not always load itself.

Or attach the MCP server: six tools (`faithful_outline`, `faithful_verify`, `faithful_audit`,
`faithful_parity`, `faithful_explain`, `faithful_guard`), each returning the same compact lines plus structured
content.

```json
{ "mcpServers": { "faithful": { "command": "npx", "args": ["-y", "@usefaithful/mcp"] } } }
```

The output is built for a token budget: a clean run is one line, a fix hint is printed once per
kind rather than once per finding, and the full result stays in `.faithful/last.json` for
`faithful explain F3` to pull on demand.

## Skills

`npx @usefaithful/cli init` installs fourteen Agent Skills into `.agents/skills/` (read by Claude Code,
Codex, Cursor, Copilot, Gemini CLI and others). Each teaches one job and ends in the command
that proves it was done:

| Skill | For |
|---|---|
| `faithful` | Running Faithful: outline, verify, audit, parity, guard |
| `faithful-implement-design` | Building a screen from a design: tokens first, copy final, verify each screen, fix what the design gets measurably wrong and declare what you change |
| `faithful-ui-quality` | A page that works and looks decided: the faults, readability, the tells of generated UI, and what NOT to flag |
| `faithful-safe-redesign` | Refactoring or re-skinning working UI in small steps with a parity check after each, so nothing users could do is lost |
| `faithful-ui-copy` | Interface wording: links that say where they go, buttons that say what they do, one name per action, useful errors |
| `faithful-design-handoff` | For design agents: a handoff a builder can match exactly and verify automatically |
| `faithful-ui-states` | Every state of a screen, not just the happy path: loading, empty, error, no permission, worst-case content — each audited on its own URL |
| `faithful-responsive` | Every width from 320px to desktop: the causes of sideways scroll, viewport units, safe areas, targets — audited across five widths |
| `faithful-accessible-forms` | Forms and custom controls everyone can use: native elements, labels, autofill, GOV.UK-style errors, visible focus |
| `faithful-dark-mode` | A dark theme that is readable and complete: `color-scheme`, semantic tokens, contrast in both themes, shadows, icons, the toggle — audited with `--color-scheme both` |
| `faithful-i18n` | UI that survives translation and right-to-left: `dir` on `<html>`, logical properties, no fixed widths, `Intl` formatting, WCAG text spacing — audited with `--stress expand,rtl,spacing` |
| `faithful-data-display` | Dashboards, tables and KPIs with real, formatted numbers and honest empty states |
| `faithful-design-tokens` | Reusing the design system's tokens and components instead of hardcoding values, proven by `guard` and `verify` against the tokens |
| `faithful-no-visual-change` | Upgrades and migrations that must change nothing on screen: the old build is the design, `verify` per page |

`--skills faithful,faithful-ui-copy` installs only those. The source is
[`packages/cli/skills/`](packages/cli/skills/); why these fourteen, and what was left out, is in
[`docs/research/skills-2026-11.md`](docs/research/skills-2026-11.md).

## Commands

```
faithful verify <design> --build <url|file> [--scroll 0,900] [--physics] [--screen <id>] [--viewports 1440x900,390x844] [--also <tokens|copy|DESIGN.md>…] [--color-scheme light|dark] [--format text|json] [--max 8]
faithful verify                        every page in faithful.config.json "checks", in one verdict
faithful audit <url|file> [--viewports 375x812,1024x768:tablet] [--color-scheme light|dark|both] [--stress zoom,reflow,expand,rtl,spacing|none] [--no-axe]  judge a page with no design
faithful parity --before <a> --after <b> [--pages /,/x]  after a refactor or redesign: nothing lost
faithful outline <design|folder>       what a design contains, in a few lines
faithful spec <design> [--out file]    the design as a Faithful spec (for design agents to ship)
faithful explain [F3|--all]            detail of a finding from the last run
faithful guard [files…] [--update-baseline]   source rules: no !important, raw colours, off-scale type
faithful selftest                      prove every rule and the comparison can see a planted fault
faithful formats                       the design formats Faithful reads
faithful doctor                        check the browser and environment
faithful init                          config, agent skill and AGENTS.md block
```

Exit codes: **0** pass, **1** fail (fix the build), **2** the call itself was wrong (a typo, a
missing file). A script that cannot tell a failing build from a typo loops on the typo.

### Advance, don't copy blindly

Where a build departs from its design to fix a measurable fault — text contrast crossing
4.5:1 (3:1 for large text), a control grown past the minimum target — `verify` reports it as
`improved`, a note, not an error. Anything else changed on purpose goes in
`faithful.deviations.json`:

```json
{ "deviations": [
  { "kind": "renamed", "match": "My orders", "reason": "copy review, Nov 2026", "owner": "design" },
  { "kind": "color", "match": "Book now", "reason": "brand refresh", "owner": "brand", "expires": "2027-03-01" }
] }
```

`match` names the element: whole words of its label, or its design or build id
(case-insensitive, at least 3 characters). A finding with no element — a landmark gone, a script
error — is matched on its detail only when the entry gives its `kind` and a phrase of 8 or more
characters. `expires` is a `YYYY-MM-DD` date, the last day the entry counts; anything else is
refused (exit 2), never read as "forever". A covered finding becomes a note quoting the reason
and gives back the score it cost; an expired entry covers nothing; an entry that covers nothing
is reported, so the file cannot quietly turn into a list of excuses. It is committed and
reviewed like code, and no MCP tool writes it.

### Guard

`faithful guard` scans source for design-system drift: raw colours outside the token file,
off-scale type, `!important`. Existing debt goes in `faithful.baseline.json`, which is
committed and may only shrink. There is deliberately no MCP tool to rewrite it: a baseline is
a decision a team reviews in a diff, and a verifier the agent can quietly loosen is no
verifier.

## Requirements

Node 22.12 or later and a Chromium. Faithful uses Playwright's browser if one is installed,
otherwise the system Chrome or Chromium; set `FAITHFUL_CHROMIUM` to choose one.
`faithful doctor` says which it found. `faithful audit` bundles axe-core (no network needed).

## Packages

| Package | |
|---|---|
| `@usefaithful/cli` | The `faithful` command and the programmatic API |
| `@usefaithful/mcp` | The MCP server |
| `@usefaithful/core` | Matching, comparison, scoring, reports, guards (no browser) |
| `@usefaithful/browser` | Rendering and extraction in Chromium |
| `@usefaithful/adapters` | The design readers |
| `@usefaithful/spec` | The Faithful spec types and validator |

### States a page reaches, and every page at once

A design is more than its first screen. `--scroll 0,900` renders the design and the build,
scrolls both to each position, and compares them there, so a header that swaps once the hero
has passed is checked in both states (`home@1440 scrolled 900`). List the pages a project
verifies once in `faithful.config.json`, and a bare `faithful verify` re-checks all of them
in one verdict — after every change, not only the one the page was built in:

```json
{ "checks": [
  { "name": "home", "design": "design/Main.dc.html", "build": "http://localhost:8099/", "viewports": "1440x900,390x844", "scroll": "0,900" }
] }
```

## Used on a real redesign

Faithful checked MAM Academy's public-site redesign (six pages from a Claude Design handoff,
ported to a PHP site, November 2026). The old homepage scored 21% against the design; the
new pages reached 78–83%, then PASS once the intended differences were declared. It caught
18 of 18 faults planted in the real build and stayed quiet on a 2px nudge; `parity` found every
destination the redesign dropped (a payment page, the blog, an applicant checklist), and the
team restored them. It found two real faults on the way: a 17px cookie-notice link and a
question counter moved 38–129px.

What it missed is in this release: a nav that wrapped and cut off its last button at 175%
text (now the default 200% pass), menus listing one screen under two names (navigation
logic), a footer's logo carried 400px down reported as missing and extra (now paired with its
neighbours), and a header changed by hand two days after the pages passed, never re-verified
and only visible after scrolling (`checks` and `--scroll`).

## How it was made

Faithful was written entirely by an AI coding agent (Claude, Anthropic), directed, reviewed
and owned by Afrovanguard. That is why every check ships with a test that fails without it,
why each was broken on purpose before it was trusted, and why its limits are written down
(`HANDOFF.md`) rather than left for you to find. Judge it by what it catches on your pages.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Every change to a check ships with a test that fails
without it. Security reports: [SECURITY.md](SECURITY.md).

## Licence

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

`@usefaithful/browser` depends on [axe-core](https://github.com/dequelabs/axe-core) (Mozilla
Public License 2.0, © Deque Systems), used unmodified and installed from npm alongside it; its
source is available from that repository.
