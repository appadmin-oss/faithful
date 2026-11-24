---
name: faithful-no-visual-change
description: Upgrade or migrate front-end code so that nothing on screen changes — a Tailwind, React, Next.js, MUI or shadcn major version, a CSS-in-JS swap, a build-tool change, a dependency bump. Use when the task says "nothing should look different", "upgrade X", "migrate to Y", "bump the UI library", or for any change meant to be invisible to users.
---

# Invisible changes: prove nothing moved

An upgrade is done when the pages are the same, pixel for pixel in layout, colour, type and
copy, and every control still works. Tests passing is not that proof.

## Before changing anything

1. Build and serve the CURRENT version and keep it running (another port or a saved build).
   That is BEFORE. Note the pages that matter.
2. Run the check once against itself to know it is clean:
   `npx @usefaithful/cli verify <before-url> --build <before-url>`.

## One step at a time

Change one thing (one package, one config, one codemod) and after EVERY step run, per page:

```
npx @usefaithful/cli verify http://localhost:4000/pricing --build http://localhost:3000/pricing --viewports 390x844,1440x900
npx @usefaithful/cli parity --before http://localhost:4000 --after http://localhost:3000
```

`verify` treats BEFORE as the design: any moved, resized, recoloured or reworded element is a
finding. `parity` proves every link, button, field and route is still there.

## Where upgrades usually change things

- Default styles that moved: Tailwind v4's border colour, ring width and preflight; a UI
  library's new default radius, spacing or font size.
- Renamed or removed utilities and props that now silently do nothing.
- Font loading changes (a different weight drawn, or a fallback face).
- Reset or cascade-order changes (`@layer`), so a later rule now wins.

Fix the cause, not the symptom: restore the old value through config or a token, never with
an override per element.

## When a difference is intended

Write it in `faithful.deviations.json` with a reason and an owner. Never loosen
`faithful.config.json` tolerances to make a run pass.

## Report

The final `faithful PASS` lines for every page and width, and each declared deviation.
