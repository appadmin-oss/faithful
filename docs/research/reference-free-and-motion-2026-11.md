# Checking UI with no design, motion, devices and reach (24 Nov 2026)

Why: the owner asked whether Faithful is useless without a design file, asked that it
"understand physics, motion, behaviours and much more" and "the right design per device",
and asked for the scope to be broadened. This is the research that answered it, with
sources. "Det" is how Faithful can do each deterministically in headless Chromium. Things
that could not be verified are marked.

## What was built from it the same day

- **The page as its own reference** (`consistency`): near-copy colours (ΔE2000 0.3–2.5),
  text sizes within 1px, radii within 2px, used once or twice beside a value used three
  times as often; a minority of buttons shaped unlike the rest. After Project Wallace's
  unique-values drift and Dembrandt's token clustering.
- **Device-correct rendering**: phones and tablets have touch and no hover
  (`(hover: none)`, `(pointer: coarse)` apply); a deployed page on a phone honours its
  viewport meta, and without one is laid out ~980px wide (an error). Overflow is measured
  against the screen width, because a phone zooms out to fit.
- **Scroll states** (`verify --scroll`) and **re-verifying every page** (`checks`).
- **Enlarged text and 320px reflow** by default; **navigation logic**; links that go
  nowhere; agent leftovers.

## 1. Judging quality with no reference

- Token inference and outliers — Dembrandt (Playwright CLI, computed styles → tokens with
  confidence): https://github.com/dembrandt/dembrandt · DesignSnap (clustering, spacing grid
  detection): https://dragoon0x.github.io/designsnap/ · Project Wallace (unique values as
  drift): https://projectwallace.com/design-tokens. None publishes accuracy.
  Det: cluster rendered values; flag one-off near-copies with both selectors. **Built**
  (colours, sizes, radii, buttons); spacing and component-group variance beyond buttons are
  next.
- Cross-page — Unlighthouse (sitemap + links, per-page audit, CI budget):
  https://unlighthouse.dev/guide/getting-started/how-it-works. Det: crawl same-origin pages,
  hash header/nav/footer landmark subtrees, report pages that differ; nav label vs the target
  page's h1/title.
- **ReDeCheck** (ISSTA 2017; ASE 2015): layout failures with no oracle, by checking the
  layout stays consistent across widths — failures in 16/26 production pages; 91% of
  injected faults. https://eprints.whiterose.ac.uk/116991 Det: sample 320–1440, build the
  sibling relation graph (above, left-of, overlaps) per width, report collisions, overflow
  and relations that flip outside a breakpoint. The strongest published reference-free method.
- Baselines — Playwright `toHaveScreenshot` (`animations: "disabled"`, `mask`, `stylePath`):
  https://playwright.dev/docs/api/class-pageassertions · Chromatic (pauses CSS animation, not
  JS; diffThreshold 0.063): https://bbc.chromatic.com/docs/animations · BackstopJS
  (`approve`): https://github.com/garris/BackstopJS. Det: `faithful approve` storing DOM,
  geometry and computed style, diffed structurally; `page.clock` frozen; fonts ready.
- Behaviour — CLS via Layout Instability API (skip `hadRecentInput`):
  https://web.dev/articles/cls · Long Animation Frames (>50ms) for scroll jank:
  https://developer.chrome.com/docs/web-platform/long-animation-frames · Target size WCAG
  2.5.8 (already built) · Focus appearance WCAG 2.4.13 (2px perimeter, 3:1 change):
  https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance. Det: Tab walk, screenshot
  before/after focus, count changed pixels; tab order vs reading order; unreachable controls.
  Hover/cursor on non-interactive elements, and the reverse (unverified heuristic).
- Aesthetic metrics — Miniukovich & De Angeli CHI 2015 (8 metrics, validated):
  https://dblp.uni-trier.de/rec/conf/chi/MiniukovichA15.html · AIM, Aalto Interface Metrics
  (17 metrics): https://interfacemetrics.aalto.fi. Det: report alignment points, grid
  quality, white-space ratio as measurements, not verdicts.

## 2. Motion, physics and behaviour

- Reading animations — `document.getAnimations()` (CSS animations, transitions and Web
  Animations; `getKeyframes()`, `getComputedTiming()`):
  https://developer.mozilla.org/docs/Web/API/Document/getAnimations · CDP `Animation` domain:
  https://chromedevtools.github.io/devtools-protocol/tot/Animation. Det: trigger, read
  duration/delay/easing/iterations per paired element, compare with tolerances.
- JS-driven motion — Playwright `page.clock` fakes rAF and timers, `runFor(ms)`:
  https://playwright.dev/docs/clock. Det: step 16.67ms, record box and transform per frame;
  overshoot %, peak time, settle time (within 1% of the end).
- Springs — fit ζ = c/(2√(km)), ω₀ = √(k/m) from the sampled step response (mass fixed at 1):
  https://theorangeduck.com/page/fitting-code-driven-displacement-revisited. Compare ζ/ω₀,
  not raw stiffness/damping (equivalent springs differ in raw values).
- Design-side motion specs — Figma REST `NodeAction.transition` (`SMART_ANIMATE`, duration,
  cubic-bezier, spring {mass, stiffness, damping}):
  https://developers.figma.com/docs/rest-api/file-property-types (a forum thread reports
  spring-duration bugs via the API) · Figma Motion API (beta, plugin-only):
  https://developers.figma.com/docs/plugins/api/Motion/ · Motion (Framer):
  https://motion.dev/docs/spring · Lottie spec: https://lottie.github.io/lottie-spec/1.0/single-page.
  Det: normalise all to cubic-bezier or ζ/ω₀ + duration.
- Reference-free motion — Material M1 durations (desktop ~150–200ms, mobile 195–375ms):
  https://m1.material.io/motion/duration-easing.html (M3 tokens 50–1000ms: secondary sources
  only) · Apple HIG Reduce Motion: https://developer.apple.com/design/human-interface-guidelines/motion.
  Det: warn on UI transitions over ~500ms and linear easing on movement.
- Reduced motion — emulation alone misses animation the page did not gate:
  https://learn.microsoft.com/microsoft-edge/devtools-guide-chromium/accessibility/test-reduced-ui-motion.
  Det: run with `reducedMotion: reduce` and without; report transform/scroll motion that still
  runs. **No existing tool compares motion between two implementations: open ground.**

## 3. The right device

- Playwright `isMobile` (viewport meta takes effect), `hasTouch`, `deviceScaleFactor`:
  https://playwright.dev/docs/emulation · ~980px layout without a viewport meta:
  https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Viewport_meta_element ·
  `(hover:none)`, `(pointer:coarse)`: https://developer.mozilla.org/docs/Web/CSS/@media/any-pointer.
  Measured here, 24 Nov 2026: a plain 390px Chromium window matches neither; `hasTouch`
  matches both; `isMobile` without a meta lays out at 980. **Built.**
- Next: `user-scalable=no` as a fault; hover-only menus under `(hover:none)`; sticky or
  scroll-swapped headers covering >25% of a short screen; safe-area insets with
  `viewport-fit=cover`.
- Frames per device — Figma `CANVAS.prototypeDevice` {type, size, presetIdentifier,
  rotation} (field names via a client library only):
  https://developers.figma.com/docs/rest-api/file-node-types. No public documentation found
  on Claude Design device frames. Det: refuse to compare a desktop frame against a phone render.

## 4. Competitors

| Tool | What it adds | Accuracy published |
|---|---|---|
| Applitools | match levels Strict/Layout/Content/Exact per region | no independent figures |
| Percy | AI review agent | vendor claim "80% fewer false positives" |
| Chromatic | per-story snapshots, TurboSnap | no |
| Lost Pixel, BackstopJS | pixel baselines, approve | no |
| Meticulous | record real sessions, replay base vs head | not found |
| Storybook 9 | `play()` interaction tests, a11y per story | n/a |
| Polypane | synced viewports, 80+ a11y tests, tab order | no |
| Lighthouse CI | budgets and assertions in CI | n/a |
| Impeccable | `npx impeccable detect`, deterministic rules | no |
| Hallmark | ~65-gate slop test run by an LLM | no |
| ai-design-tells, pixelslop | tell catalogues | no |

None of the slop or audit tools publishes precision/recall. A published benchmark is
Faithful's to own.

## 5. Papers with measured accuracy

- GVT (ICSE 2018), design violations vs mockups: 98% precision / 96% recall on injected
  violations. https://arxiv.org/pdf/1802.04732
- OwlEye (ASE 2020), display issues: 85% / 84%; Nighthawk localises them.
  https://arxiv.org/abs/2009.01417 · https://arxiv.org/abs/2205.13945
- UIS-Hunter (ICSE 2021), 71 Material "don't" rules: 0.81 / 0.90.
  https://xin-xia.github.io/publication/icse213.pdf
- UICrit (UIST 2024): 3,059 critiques on 983 UIs. https://arxiv.org/abs/2407.08850
- UIClip (UIST 2024): quality/relevance model, MIT. https://arxiv.org/abs/2404.12500
- Design2Code: 484 pages, Block-Match. https://arxiv.org/abs/2403.03163 · WebSight: 2M
  synthetic pairs. https://huggingface.co/datasets/HuggingFaceM4/WebSight
- Det: port UIS-Hunter-style rules to the DOM; use these sets to inject faults and publish
  precision and recall.

## 6. Beyond one web page

- Storybook: stories × args × states, each audited.
- Email: caniemail data https://www.caniemail.com/api/data.json, `doiuse-email`; render at
  600px with `<style>` stripped for Gmail.
- Print/PDF: `emulateMedia({media:'print'})`, `page.pdf()`, veraPDF `--flavour ua1`
  (https://verapdf.org).
- Native: take XCUITest `performAccessibilityAudit()` results in rather than reimplement.
- PWA/offline: `context.setOffline(true)` after load; a meaningful offline state, not blank.

## 7–9. Copy, flows, performance, charts, colour modes

- Copy: alex (insensitive wording; false positives known) https://github.com/get-alex/alex;
  Flesch-Kincaid per block; a glossary for terminology across pages; `Intl` round-trips
  against `<html lang>`; error/empty-state microcopy rules.
- Flows: submit forms empty and invalid (messages tied by `aria-describedby`, focus to the
  first error, input kept); `page.route` delays/failures to force loading, empty and error
  states — each must show a state and a retry.
- Performance: web-vitals attribution build (LCP > 2.5s, CLS > 0.1 under throttling):
  https://github.com/GoogleChrome/web-vitals
- Charts and colour: CDP `Emulation.setEmulatedVisionDeficiency`; forced colours via
  `setEmulatedMedia`; series colours distinguishable (ΔE > ~10) under each deficiency; axis
  labels and a chart title.

## 10–11. Agents and reach

- Playwright MCP drives by accessibility-tree refs, not pixels:
  https://playwright.dev/mcp/introduction · Claude Code best practice "give Claude a way to
  verify its work": https://code.claude.com/docs/en/best-practices. Agents act best on a
  terse ranked list with stable kinds, selectors, measured vs expected, a fix, exit codes —
  Faithful's compact report already is this.
- MCP Registry (`server.json`, `mcp-publisher`, `mcpName` in package.json):
  https://modelcontextprotocol.io/registry/quickstart · Agent Skills (agentskills.io; skills.sh,
  `npx skills add owner/repo`): https://vercel.com/blog/state-of-agent-skills · Lighthouse CI
  spread through a ready GitHub Action: https://github.com/treosh/lighthouse-ci-action ·
  Impeccable through npx + skill + a named catalogue of tells. (Inference: one-line npx, a
  shareable catalogue, CI exit codes and skill packaging drive adoption; no metrics found.)

## Ranked next (from the research, after what was built)

1. Cross-viewport layout consistency (ReDeCheck).
2. Motion capture: `page.clock` stepping + `getAnimations()`; duration, easing, overshoot,
   settle; spring fitting against Figma/Motion/Lottie.
3. Reduced-motion, forced-colours and dark re-runs diffed against the normal run.
4. Keyboard pass: tab order, unreachable controls, focus visible by pixel change.
5. Forced states: network faults for loading/empty/error, form error recovery, offline.
6. Site crawl: header/nav/footer consistency, nav label vs page title across pages.
7. `faithful approve`: structural baselines.
8. A published precision/recall benchmark from injected faults.
9. Hover-only UI under `(hover:none)`; `user-scalable=no`.
10. Spacing and component-group variance in `consistency`.

Not verified: Claude Design device-frame metadata; a tool named "slop-detect" (the peer repo
audited in this session is ravidsrk/slop-detect on GitHub; the researcher found no listing
under that name); M3 motion tokens from m3.material.io; Figma `prototypeDevice` enum values.
