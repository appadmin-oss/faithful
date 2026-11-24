---
name: faithful-implement-design
description: Build a screen from a design reference — Claude Design .dc.html or canvas, Figma export, HTML/JSX prototype, mockup, DESIGN.md or tokens — so it matches where the design is right and improves on it where it is measurably wrong. Use at the START of implementing any designed UI, not after review says it looks off.
---

# Implement a design: faithful, not blind

A design is a specification: its colours, sizes, radii, copy and states were decided. Match
them. Where it fails a measurable rule — contrast, target size, reflow — fix it and say so.
Never "improve" by taste.

## Before writing UI

1. `npx @usefaithful/cli outline <design>` — screens, copy, palette and type scale in a few lines.
   A Claude Design canvas (`project/canvas.json`) lists one screen per board, by id.
2. Read the whole handoff (README, notes, chats). States, permissions and edge cases are
   written there, not drawn: empty, loading, error, offline, signed out.
3. Read the design's SOURCE, not a screenshot. Take geometry, colour, type, copy and
   behaviour; leave the prototype's scaffolding (template holes, support scripts, mock data).
4. Map the codebase: its components, routing, theming and data layer. Reuse what exists.

## Tokens first

Put the design's colours, type sizes, spacing, radii and shadows in the project's theme
before building anything. After that no hex, size or radius is typed anywhere else. Needing
a value the tokens lack means you misread the design: look again, then ask.

## Build one screen at a time

- Copy is final. Ship the exact strings; a wrong-looking one is a question, not an edit.
- Every state the design shows or describes, reachable in the build.
- Touch targets at least 24px (44px on phones for primary actions).
- `prefers-reduced-motion` honoured; safe areas respected.

Then verify, at the design's own size, and fix before moving on — drift compounds:

```
npx @usefaithful/cli verify <design> --build <url-or-file> [--screen <id>]
```

A design of several boards (a canvas) is several pages: name the one this build is with
`--screen <id>`. Its tokens (`project/tokens.json`) check the palette: `--also project/tokens.json`.

Fix errors (E) first: missing elements, copy, sizes. Position findings are often symptoms of a
size above them. Re-run until `faithful PASS`; paste that line in your report.

## Advance, don't copy blindly

Where the design fails a rule a checker can measure, build it right:

- text under 4.5:1 contrast (3:1 for large text) → darken it to the nearest token that passes;
- a control under 24px → give it padding;
- a fixed width that scrolls sideways on a phone → let it wrap.

Faithful reports these as `improved`, not as errors. Anything else you change on purpose —
a renamed label, a dropped decoration — goes in `faithful.deviations.json` with a reason and an
owner, so a reviewer sees it in the diff. Never edit that file, the baseline or the config
just to make a check pass.

## Report

What you built, what you deviated from and why, the verify line, and open questions. Never
claim a match you did not run.
