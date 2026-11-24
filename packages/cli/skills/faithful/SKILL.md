---
name: faithful
description: Prove a UI build matches its design before calling it done. Use when implementing or reviewing a screen from a design handoff, Claude Design .dc.html, Figma export, HTML prototype, mockup, screenshot, DESIGN.md or design tokens; when asked if a page "matches the design", is "pixel-perfect" or "faithful"; and before reporting UI work complete.
---

# Faithful: build to the design, then prove it

A design is a specification. Every colour, size, radius, string and state in it was decided.

## Before building

1. `npx @usefaithful/cli outline <design>` — screens, copy, palette and type scale in a few lines.
   For a handoff folder: `npx @usefaithful/cli outline <folder>` lists which files are designs.
2. Put the design's tokens in the project's theme first. No colour or size is typed anywhere else.
3. Copy is final. Use the design's strings exactly.

## After each screen

```
npx @usefaithful/cli verify <design> --build <url-or-file> [--viewports 1440x900,390x844]
```

- The output is a verdict line and the worst findings, each with one fix. Fix errors (E) first.
- `npx @usefaithful/cli explain F3` for one finding; `--all` for every one. Full JSON: .faithful/last.json.
- Re-run until it prints `faithful PASS`. Paste that line in your report as proof.
- "(indicative)" means the design could not be placed (tokens, a copy deck, an image without a
  sidecar): say so in your report rather than claiming a match.

## A page with no design (or before calling any UI done)

`npx @usefaithful/cli audit <url-or-file>` — at phone and desktop width: text cut off or drawn
over text, sideways scroll, broken images, `undefined` on the page, text contrast,
readability, vague link and button wording, and the tells of generated UI. Fix every E; treat
"reads as generated" as a design problem to solve, not a style to keep. A page with a dark
theme: add `--color-scheme both` (also `--color-scheme dark` on `verify`).

## Refactoring or redesigning something that already works

Record the BEFORE build first (a URL, or the built HTML), then after every step:
`npx @usefaithful/cli parity --before <old> --after <new>` — every link, button, form field,
landmark and route must still be there; looks are ignored. "renamed" needs your confirmation;
"lost" and "changed" mean users can no longer do something they could. Improve freely — a
redesign should be better than the design or code it replaces — but never drop a function
silently.

## Before committing

`npx @usefaithful/cli guard` — no new !important, raw colours or off-scale type. Existing debt is in
faithful.baseline.json and may only shrink. Never edit the baseline or faithful.config.json to
make a check pass; if a rule is wrong for this project, say so and ask.

With the Faithful MCP server attached, `faithful_outline`, `faithful_verify`,
`faithful_audit`, `faithful_parity`, `faithful_explain` and `faithful_guard` do the same and return the same lines.

## Design agents

Ship a spec beside your prototype so builders can verify against it:
`npx @usefaithful/cli spec <prototype.html> --out <name>.faithful.json`
