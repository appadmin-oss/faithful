---
name: faithful-design-tokens
description: Use the design system's tokens and components instead of hardcoded values — no raw hex colours, off-scale font sizes, magic spacing, one-off radii or re-created components. Use when asked to "follow the design system", "use our tokens", "remove hardcoded colors", "make theming work", "clean up the CSS", or before adding any styling to a codebase that has a theme.
---

# Design tokens and components: reuse, never re-create

Agents read the tokens file and then write `#3b82f6`, `gap-[13px]` and a fresh `<Button>`
anyway. Three shades of brand blue follow, and theming breaks.

## Before writing any style

1. Find the system: tokens (`tokens.json`, CSS custom properties, Tailwind `@theme`/config),
   the component folder or Storybook, and any `DESIGN.md`. Read them.
2. List the components you will reuse for this task. If nothing fits, say so and report
   the gap — do not quietly invent a near-duplicate.
3. Match the codebase's naming for files, props and variants.

## Rules

- Colours, font sizes, spacing, radii, shadows and durations come from tokens. That
  includes inline styles, chart strokes, SVG fills and Tailwind arbitrary values (`[#…]`).
- Reference semantic tokens (`--color-surface`, `text-muted`), not palette steps
  (`blue-500`), so a theme can swap them.
- A value that is not on the scale is either a mistake or a new token: ask the design owner;
  do not add it inline.
- Use the system's `<Button>`, `<Input>`, `<Dialog>`; never a raw `<button>` restyled to look
  like one.
- No `!important`; fix the specificity or the layer order.

## Prove it

```
npx @usefaithful/cli guard
npx @usefaithful/cli verify tokens.json --build <url>
```

`guard` scans the source for raw colours, off-scale type and `!important`, and fails only on
files that got worse than the committed `faithful.baseline.json`. `verify` against the token
file checks that the rendered page uses only the system's colours, sizes and faces. When
replacing existing hardcoded values, also run
`npx @usefaithful/cli verify <before-url> --build <after-url>` so the swap moved nothing.

Never edit the baseline or the config to pass. Run `guard --update-baseline` only to lock in
an improvement, and say so in the report.

## Report

The guard and verify lines, the components reused, and any gaps reported to the owner.
