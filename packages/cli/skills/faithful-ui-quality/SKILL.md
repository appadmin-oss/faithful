---
name: faithful-ui-quality
description: Make a UI that works and looks deliberate rather than generated — no clipped or overlapping text, no sideways scroll, no placeholder data, readable, and free of the tells of AI-made design. Use when building or reviewing any page without a design to match, when a UI is called generic, "AI-made", cheap or broken on mobile, and before calling UI work done.
---

# UI quality: works for people, looks decided

Run the audit at phone and desktop width:

```
npx @faithful/cli audit <url-or-file>
```

Fix every error (E). Each finding names the element and one fix.

## Faults first — a user cannot get past these

- Text cut off by its box: use `min-height`, never a fixed `height`, on anything holding text.
- Text on text, or covered by a sticky bar: separate it; add `scroll-padding-top`.
- Sideways scroll on a phone: hunt fixed widths, `100vw`, `white-space: nowrap`, long URLs.
- `undefined`, `NaN`, `[object Object]`, `{{ x }}` on the page: a value failed to load. Fix the
  data path and design the empty state.
- Lorem ipsum, John Doe, placeholder images, "Your Company": replace with real content, or
  ask for it. Never invent testimonials, logos or statistics.
- Content at opacity 0 until a scroll script runs: show it by default; animate only as an
  enhancement.

## Reading

Body text 16px or more on phones, line height about 1.5, lines 50–75 characters, one type
scale (a handful of sizes), contrast 4.5:1 for text.

## The tells of generated UI

Each is a legitimate choice somewhere; together they say nobody decided anything. Replace
them with a choice specific to this product:

- gradient text; coloured glow shadows; frosted glass on everything;
- emoji as icons; an icon tile above every heading; three identical cards in a row;
- a pill badge above the headline; a coloured stripe down one side of every card;
- cards nested in cards; copy that fits any product ("Elevate your workflow", "seamless").

Do NOT "fix" these when they are the product's real identity: a purple brand, Inter or Geist
on their own, glass on a sticky header or a modal, emoji in a consumer app, a callout with a
coloured left border, a dark-only product (check its contrast, not its darkness).

## What deliberate looks like

One accent colour, one radius, a small type scale, left-aligned body text, real names and
numbers with units, designed hover/focus/disabled states, and empty, loading and error
states that say what happened and what to do.

Re-run the audit until it prints `faithful PASS`; paste that line in your report.
