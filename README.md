# Faithful

**Prove that what was built matches what was designed.** For coding agents, design agents and
the people reviewing their work.

A design is a specification: every colour, size, radius, string and state in it was decided.
Most "does it match the design?" checks are a person squinting at two screenshots, or an agent
saying it tried. Faithful renders both, pairs every element, and says exactly what differs, in
a few lines an agent can act on:

```
$ npx @faithful/cli verify design.html --build build.html --viewports 1440x900
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

> **Use `npx @faithful/cli`, never `npx faithful`.** The unscoped name on npm is an unrelated
> package; in a project without Faithful installed, the short form downloads and runs it.

## No design? Audit the page

```
$ npx @faithful/cli audit http://localhost:3000
```

Judges a page on its own, at a phone and a desktop width, and reports each fault once:

- **Faults a user cannot get past:** text cut off by its box or drawn over other text, a page
  that scrolls sideways on a phone, broken images, script errors, `undefined` /
  `[object Object]` / `{{ x }}` printed where a value should be, lorem ipsum.
- **Reading:** lines longer than 75 characters, tight line height, small body text, targets
  under 24px, more than ten font sizes.
- **Wording:** links named "click here", a row of "Learn more" links to different places,
  "Submit" buttons, one action under two names (Sign in / Log in), headings mixing Title Case
  and sentence case, doubled words.
- **The tells of generated UI:** gradient text, coloured glow, emoji as icons, a stripe down
  one side of a card, cards in cards, frosted glass, a pill badge above the headline, copy
  that could describe any product. One tell is a warning; a purple brand set in Inter is not
  flagged at all. Several strong tells together fail the page as "reads as generated".

`fixtures/audit/` holds a page with every fault planted and a plain, deliberate page that must
stay clean; both are run on every test.

## Refactoring or redesigning? Prove nothing was lost

```
$ npx @faithful/cli parity --before http://localhost:3000 --after http://localhost:3001
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
| HTML / JSX prototypes, dev servers, live URLs | Rendered in Chromium |
| Figma REST exports (`GET /v1/files/:key`) | Frames become screens, frame-relative |
| A Faithful spec (`*.faithful.json`) | Written by a design agent, or by `faithful spec` |
| Design tokens: DTCG JSON, CSS custom properties, Tailwind v4 `@theme` | An inventory: is every colour, size and radius in the build one the design has? |
| `DESIGN.md`, copy decks (`.txt`) | The same, from prose and from the copy |
| Reference images | Placed with a `.faithful.json` sidecar, indicative without one |

A design that can be placed (it has screens) is compared element by element at its own
viewport. One that cannot (tokens, a copy deck) is checked for **conformity**, and the result
says `(indicative)` so nobody reports it as a match.

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
- **Touch targets** under the minimum.
- **Faults the design has too** are notes, not errors: you are not asked to fix the designer's
  12px button.

Findings come back root-cause first: missing, copy and size before the positions they move.

## For agents

```
npx @faithful/cli init
```

writes `faithful.config.json`, twelve Agent Skills under `.agents/skills/` (see [Skills](#skills)),
and a short block in `AGENTS.md`, because a skill does not always load itself.

Or attach the MCP server: six tools (`faithful_outline`, `faithful_verify`, `faithful_audit`,
`faithful_parity`, `faithful_explain`, `faithful_guard`), each returning the same compact lines plus structured
content.

```json
{ "mcpServers": { "faithful": { "command": "npx", "args": ["-y", "@faithful/mcp"] } } }
```

The output is built for a token budget: a clean run is one line, a fix hint is printed once per
kind rather than once per finding, and the full result stays in `.faithful/last.json` for
`faithful explain F3` to pull on demand.

## Skills

`npx @faithful/cli init` installs twelve Agent Skills into `.agents/skills/` (read by Claude Code,
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
| `faithful-data-display` | Dashboards, tables and KPIs with real, formatted numbers and honest empty states |
| `faithful-design-tokens` | Reusing the design system's tokens and components instead of hardcoding values, proven by `guard` and `verify` against the tokens |
| `faithful-no-visual-change` | Upgrades and migrations that must change nothing on screen: the old build is the design, `verify` per page |

`--skills faithful,faithful-ui-copy` installs only those. The source is
[`packages/cli/skills/`](packages/cli/skills/); why these twelve, and what was left out, is in
[`docs/research/skills-2026-11.md`](docs/research/skills-2026-11.md).

## Commands

```
faithful verify <design> --build <url|file> [--viewports 1440x900,390x844] [--also <tokens|copy|DESIGN.md>…] [--format text|json] [--max 8]
faithful audit <url|file> [--viewports …]  judge a page with no design
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
`faithful doctor` says which it found.

## Packages

| Package | |
|---|---|
| `@faithful/cli` | The `faithful` command and the programmatic API |
| `@faithful/mcp` | The MCP server |
| `@faithful/core` | Matching, comparison, scoring, reports, guards (no browser) |
| `@faithful/browser` | Rendering and extraction in Chromium |
| `@faithful/adapters` | The design readers |
| `@faithful/spec` | The Faithful spec types and validator |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Every change to a check ships with a test that fails
without it. Security reports: [SECURITY.md](SECURITY.md).

## Licence

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
