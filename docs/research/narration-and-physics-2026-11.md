# Copy that narrates, and motion that has no declaration (25 Nov 2026)

Two requests from the owner, recorded with the evidence behind what was built.

## 1. "All these descriptions under headings make the whole thing feel AI slop"

The example: a finance product where almost every page opens with a paragraph explaining
itself, every card repeats the pattern, and footers sign off "Every figure here is derived from
the ledger…".

### What the guidance says

All of it agrees, and none of it disagrees:

- **GOV.UK Design System** — hint text only when it helps people answer, never to restate the
  label; no introductory text on question pages. Content design: people do not read
  introductions, they scan for what they came for.
- **"Bypass the blurb"** (content-design writing) — the paragraph under a heading that says what
  the section is "about" is the first thing to cut.
- **Microsoft Writing Style Guide** and the older Win32 UX text guidance — do not describe the
  interface ("this page lets you", "use this dialog to"); say what to do.
- **Nielsen Norman Group** — readers skip introductory and "welcome" copy; instructional text
  that restates the obvious is ignored, and costs the attention the rest of the page needs.
- **Mailchimp content style guide** — say what something is or does, once, in the reader's
  terms; no filler.

### What the catalogues of generated-UI tells say

pixelslop (its pattern 19 and its S11 copy rule), impeccable and MengTo's slop audit all list
"explanatory subtitles" and templated card copy among the tells. **None gives a deterministic
test for the intro-paragraph tell**; that is what Faithful adds.

### What was built (`packages/core/src/narration.ts`)

Four rules, each a test over text, not a model:

| Rule | Fires on | Never on |
|---|---|---|
| Self-reference | the first sentence under a heading names the interface: "This page shows…", "The dashboard gives you…", "Here you can…", "Use this section to…", "From here, you can…" | a legal or regulatory notice |
| Echo | a short sentence (≤25 words) whose content words overlap the heading's by half or more of their union ("Recent activity" / "Your recent account activity") | a sentence carrying a number, currency, date or a name mid-sentence; one that repeats the heading and says more ("Check your answers before sending your application") |
| Templated cards | three or more cards in one grid whose blurbs (8–40 words) all open with the same word ("Easily…"), or mostly narrate their headings | cards carrying digits or currency (a table drawn as cards); an article as the opening word |
| Sign-off | "Every/all figure(s)/amount(s)/total(s) … is/are derived/calculated/sourced…" | FCA/SEC/FDIC/CBN wording, "not financial advice", "capital at risk", ©, terms, privacy |

Where the probe looks (`audit-probe.ts`): the first prose after each `h1`–`h4`, in its own block
or the block after a heading wrapper. Skipped: anything a field points at with
`aria-describedby` (a hint is allowed to explain), text in `<details>`, a form, a fieldset, a
label or a status region, and classes named hint/help/empty.

**Restraint.** One narrating heading is a choice: a note. Two or more is a warning and a strong
tell in the slop co-occurrence count, so a page that also has gradient text and a pill badge
reads as generated. A single sign-off is a note; two are a warning.

**Negatives.** Written as GOV.UK service pages write (`narration.test.ts`, eleven cases), plus a
browser test with a real hint, an open `<details>`, a Crown copyright footer; and three live
GOV.UK pages (renew a passport, a browse page, the design system's components index) audited
with no narration finding.

## 2. Physics: motion that declares nothing

The motion reader (`motion.ts`, committed before this) reads what a stylesheet declares. A
spring (Framer Motion, react-spring), a script tweening a style each frame, a transition a class
sets going on load — none has a declaration to read. Their trajectory is the design.

### What was built

- **Recorder** (`packages/browser/src/physics.ts`), an init script in the page's own world: every
  frame, the rect and opacity of every element a finite animation targets or whose `style` a
  script writes; a frame kept only when something changed; at most 40 elements, 120 frames
  each, six seconds. "At rest" is nothing moving by more than 0.02px for 400ms and nothing
  finite still running — measured frame to frame, so a slow tail is not mistaken for rest.
  On, with `verify --physics` (the page is loaded with motion on; reduced motion is restored
  before anything is measured).
- **Analysis** (`packages/core/src/physics.ts`): per channel (x, y, width, height, opacity)
  distance and direction, time to rest (within 2%), overshoot and swings, and for a move that
  does not overshoot, how far along it is halfway through its time (ease-out vs even vs ease-in).
- **Spring fit**: the standard second-order response, ζ = −ln(OS)/√(π² + ln²OS),
  ω₀ = π/(t_peak·√(1 − ζ²)); stiffness ω₀² and damping 2ζω₀ per unit mass, the numbers spring
  libraries take. Two corrections, each with a test that fails without it:
  the peak is interpolated between frames (a parabola through the three around it), and the
  start is extrapolated from the first frames (a spring leaves rest as t²), because the first
  sample can be a frame late. Without them the fitted stiffness swung 0–18% with the frame
  phase; with them it is within 10% at every phase.
- **Measured on a real page**: a spring stepped by the page's own semi-implicit Euler at 60fps
  (nominal k = 300, c = 14) actually peaks at 183ms with 22.6% overshoot — the integrator, not
  the measurement, is stiffer than nominal. Faithful reported 22.5–23.2% and stiffness 359–384
  against that motion's own 360, over three runs.
- **Compare**: a movement the design makes and the build does not is an error; a different
  time, distance, direction, curve, or a spring built as a glide is a warning ("the design
  springs (overshoots 23%, 2 swings; stiffness ≈ 365, damping ≈ 16); the build stops dead");
  when it starts is a note (that is the page's load as much as the design).

### Not done

Hover, press and scroll-linked motion (the recorder watches entry only); Figma and Lottie motion
specs as a design source; a reference-free check of motion against platform duration ranges.
