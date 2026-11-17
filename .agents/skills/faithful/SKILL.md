---
name: faithful
description: Prove a UI build matches its design before calling it done. Use when implementing or reviewing a screen from a design handoff, Claude Design .dc.html, Figma export, HTML prototype, mockup, screenshot, DESIGN.md or design tokens; when asked if a page "matches the design", is "pixel-perfect" or "faithful"; and before reporting UI work complete.
---

# Faithful: build to the design, then prove it

A design is a specification. Every colour, size, radius, string and state in it was decided.

## Before building

1. `npx @faithful/cli outline <design>` — screens, copy, palette and type scale in a few lines.
   For a handoff folder: `npx @faithful/cli outline <folder>` lists which files are designs.
2. Put the design's tokens in the project's theme first. No colour or size is typed anywhere else.
3. Copy is final. Use the design's strings exactly.

## After each screen

```
npx @faithful/cli verify <design> --build <url-or-file> [--viewports 1440x900,390x844]
```

- The output is a verdict line and the worst findings, each with one fix. Fix errors (E) first.
- `npx @faithful/cli explain F3` for one finding; `--all` for every one. Full JSON: .faithful/last.json.
- Re-run until it prints `faithful PASS`. Paste that line in your report as proof.
- "(indicative)" means the design could not be placed (tokens, a copy deck, an image without a
  sidecar): say so in your report rather than claiming a match.

## Before committing

`npx @faithful/cli guard` — no new !important, raw colours or off-scale type. Existing debt is in
faithful.baseline.json and may only shrink. Never edit the baseline or faithful.config.json to
make a check pass; if a rule is wrong for this project, say so and ask.

With the Faithful MCP server attached, `faithful_outline`, `faithful_verify`,
`faithful_explain` and `faithful_guard` do the same and return the same lines.

## Design agents

Ship a spec beside your prototype so builders can verify against it:
`npx @faithful/cli spec <prototype.html> --out <name>.faithful.json`
