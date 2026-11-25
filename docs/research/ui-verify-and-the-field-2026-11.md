# UI Verify and the field: a critical comparison (25 Nov 2026)

The owner asked for a "full-house critical analysis" of UI Verify against Faithful. Claims about
UI Verify are from its public pages, linked; anything the vendor says about itself is marked
self-reported. Faithful's side is measured, and its own weaknesses are listed first.

## What UI Verify is

"Visual testing for coding agents", by Igor Luchenkov (London), launched on Product Hunt around
24 Nov 2026 (#16 of the day, 106 upvotes) — https://www.producthunt.com/products/ui-verify.

- **A hosted service.** The open-source parts (MIT, `uiverify/uiverify`, ~39 stars) capture and
  upload: a CLI (`upload`, `check`), Playwright/Vitest/Bun plugins and agent skills. Rendering,
  diffing and judging happen on their servers; an account or API key is required; the MCP
  server is remote (`uiverify.ai/mcp`) — https://github.com/uiverify/uiverify, https://uiverify.ai.
- **Change against a baseline.** Pixel diff against versioned baselines from the default branch,
  rendered in their pinned cloud browser (Chromium; Firefox and WebKit for Storybook).
  Deterministic captures: reduced motion, frozen clock, GIFs held, `data-uiverify-ignore` blacks
  out a region; a diff that does not reproduce on a re-render is dropped as a flake —
  https://uiverify.ai/docs/deterministic-captures.
- **An AI judge** labels each change "likely regression" or "likely intended" from the baseline,
  the candidate, the changed regions and the PR's title and description. It never changes a
  baseline; a human or an authorised agent must accept every change —
  https://uiverify.ai/docs/the-ai-judge. The model, the diff thresholds and the judge's accuracy
  are not published.
- **Affected screens only**: a change re-renders the screens using what changed (median PR on
  their own app: 13 of 154 screens — self-reported).
- **Design comparison** is a whole-image pixel diff against a Figma export set as a story's
  baseline — https://uiverify.ai/docs.
- **Price** (https://uiverify.ai/pricing): free 10k snapshots a month (50k for open source),
  then Starter (30k snapshots, 1k AI reviews) and Pro (65k, 2.5k); overage $0.004 a snapshot and
  $0.03 an AI review. Customers named: JetBrains, Cura and others (self-reported).

## Head to head

| | UI Verify | Faithful |
|---|---|---|
| Question answered | Did it change since main? | Is it right — against the design, or against the page's own system and the standards? |
| Needs | An account, uploads, a baseline history | Nothing: local, no account, no history |
| Verdict | Pixel diff + an unnamed AI model's label; a human accepts | Deterministic rules; every rule has a test that fails without it; a published benchmark |
| Says what is wrong | Changed regions | The element, the property, the number, and the value to use |
| Design file | Pixel diff against one exported frame | Element by element: position against neighbours, type, colour (CIEDE2000), copy, targets, motion, frame-sampled physics |
| No design | No (needs a baseline) | Audit: stress passes, axe-core, contrast as drawn, navigation, narration, design sense |
| Refactor safety | Visual change | Parity: every link, button, field and route still there |
| Scale | Storybook-wide fan-out, three engines, native screenshots | One page or a configured list; Chromium only |
| Workflow | PR checks, merge gate, review UI, accept over MCP | A report and an exit code; MCP tools; no review UI |
| Cost | Metered per snapshot and per AI review | Free (Apache-2.0) |

### Where UI Verify is genuinely stronger

1. **It catches what nobody named.** Re-rendering every screen that uses a changed component,
   against history, finds the 3px shift on a page no one asked about. Faithful verifies the
   pages it is pointed at; parity proves nothing was *lost*, not that nothing *moved*.
2. **The workflow around the verdict.** A merge gate, a review screen, per-screen history and
   acceptance over MCP. Faithful stops at the report.
3. **Flake handling as a rule.** Re-rendering and keeping only what reproduces is mature
   practice. Faithful freezes motion and waits on fonts and frames, but does not re-sample.
4. **Reach.** Three engines, Storybook at scale, native apps through uploads.

### Where Faithful is stronger

1. **Right, not just unchanged.** A baseline answers "did it change?". A first build, or a
   baseline already wrong, is accepted as truth. Faithful's verdicts need no history: a design
   file, or the page's own fitted system, or the standards.
2. **Precision about the fault.** A pixel diff against a Figma export cannot say which element
   is wrong or by how much, flags anti-aliasing while missing a one-step colour drift, and is
   blind to copy, targets and motion. Faithful names the element, the property and the value.
3. **A verdict you can audit.** UI Verify orders its queue with an AI model whose accuracy is
   not published. Faithful's rules are code, each held by a test that fails without it, with a
   labelled benchmark in the suite (`pnpm bench`) and live-site measurements in the README.
4. **No upload, no meter.** Nothing leaves the machine; nothing is billed per screenshot.
5. **Breadth without a baseline.** Accessibility (axe-core, contrast as drawn, reduced motion,
   pictures of UI exposed to screen readers), internationalisation stress, design sense, copy.

### Weaknesses of both

- Neither publishes an independent accuracy figure. Faithful's benchmark is written by the same
  hands as its fixes (said so in the README); UI Verify publishes none.
- Both render in a headless browser and can be fooled by state that only appears after
  interaction; neither drives hover, focus or forms by default.

## What Faithful takes from this

Done now:
- **`data-faithful-ignore`**: an author marks a region (a clock, live prices) and it is left out
  of verify and audit on both sides — UI Verify's `data-uiverify-ignore`, without the blackout.

Next, in order (also in HANDOFF):
1. **Affected pages**: given a changed component, find the routes and boards that render it and
   verify them all — UI Verify's best idea, and Faithful's clearest gap.
2. **Re-sample before reporting** a layout fault that could be timing (an overlap mid-transition):
   report it only if a second capture reproduces it.
3. **A local baseline mode** for parity: "unchanged since main" beside "matches the design",
   still deterministic, still with no service.
4. **A PR-ready report** (a GitHub check summary from `--format json`), so the verdict lands
   where review happens.

## The rest of the field, briefly

- **Percy Visual Testing Plugin** (beta): Percy inside Claude Code, Cursor, Codex, Copilot and
  Gemini; a paid Visual Review Agent sorts each diff as intended or a bug —
  https://www.browserstack.com/docs/percy/ai-agents/visual-testing-plugin.
- **Qodo Design Review Agent** (research preview): compares a PR to Figma and reports UX
  deviations — https://docs.qodo.ai/code-review/view-ux-deviations-in-findings.
- **Argos**: open-core visual testing marketed to agents (its agent post was unreachable when
  checked).
- **Playwright MCP / Chrome DevTools MCP**: give an agent a browser to drive or inspect; neither
  gives a verdict. Faithful is the verdict those agents can call.
