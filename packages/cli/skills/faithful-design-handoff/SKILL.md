---
name: faithful-design-handoff
description: For design agents and designers — produce a handoff a coding agent can build exactly and verify automatically: tokens, every state, final copy, and a machine-readable spec. Use when finishing a design, prototype or design system meant to be implemented.
---

# A handoff that can be verified

A builder can only match what the handoff states. Everything left unsaid gets invented.

## Ship these

1. **Tokens** in one file: colours (with what each is for), type scale, spacing, radii,
   shadows, motion. DTCG JSON, CSS custom properties, Tailwind `@theme` or a Claude Design
   `design-system.json` + `tokens.json` (`{name, value, usage}`, per theme) are all read.
2. **Every screen at its real size**, phone and desktop, as HTML/JSX, Claude Design boards on a
   canvas (each board's `w` is its size; its file name is its `--screen` id) or a Figma export — not
   only screenshots; source carries exact values, a picture carries guesses.
3. **Every state**: default, hover, focus, pressed, disabled, loading, empty, error, offline,
   signed out. Drawn, or written down.
4. **Final copy**, including errors, empty states and confirmation messages.
5. **A spec**, so the build can be checked against the design automatically:

```
npx @faithful/cli spec <prototype.html> --out <screen>.faithful.json
```

## Make the design pass its own checks

Before handing off, run `npx @faithful/cli audit <prototype>`. Text contrast, target sizes
and readable line lengths are rules, not taste: a design that fails them will be "improved"
by the builder, and the build will then differ from what you drew.

## Say what may change

Mark what is fixed (brand colours, copy, layout) and what is the builder's call (exact
breakpoints, loading treatment). Unstated, a careful builder treats everything as fixed —
including your mistakes.
