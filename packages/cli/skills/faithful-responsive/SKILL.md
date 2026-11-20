---
name: faithful-responsive
description: Make a layout work at every width from a small phone to a wide desktop, and prove it — no sideways scroll, nothing clipped or overlapping, targets big enough for a thumb. Use when a page is "broken on mobile", "not responsive", scrolls sideways on an iPhone, looks wrong on a tablet, or before shipping any layout change.
---

# Responsive: every width, proven

Generated layouts are usually designed at one desktop width and break at 375 px and at the
in-between widths nobody looked at (768, 834, 1024).

## Check across the range

```
npx @faithful/cli audit <url-or-file> --viewports 320x568,375x812,768x1024,1024x768,1440x900
```

Fix every error, then re-run. If the design has a phone board, also run
`npx @faithful/cli verify <design> --build <url> --viewports 390x844,1440x900`.

## Causes of sideways scroll, in order of frequency

1. A fixed `width` or `min-width` in px wider than the screen: use `max-width` and `%`/`fr`.
2. `100vw`: it includes the scrollbar. Use `100%`.
3. `white-space: nowrap`, long URLs or long words: add `overflow-wrap: anywhere`.
4. Images or embeds without `max-width: 100%` and `height: auto`.
5. Negative margins and absolutely positioned decorations poking past the edge.

Never "fix" it with `overflow-x: hidden` on `body`: that hides content and breaks sticky.

## Rules

- Start from the narrowest layout and add columns with `min-width` media or container
  queries; components placed in slots of different widths use `@container`.
- Use `100svh`/`100dvh`, not `100vh`, for full-height sections on phones.
- Pad bars at the screen edge with `env(safe-area-inset-*)` when `viewport-fit=cover` is set.
- Keep `<meta name="viewport" content="width=device-width, initial-scale=1">`; never
  `user-scalable=no` or `maximum-scale=1` (WCAG 1.4.4).
- Form inputs at 16 px or more, or iOS zooms on focus.
- Touch targets at least 24×24 CSS px (WCAG 2.5.8), 44 px for primary actions.
- Hover-only features need a tap path; gate hover effects with `@media (hover: hover)`.
- Tables and code scroll inside their own container, never the page.
- Content reflows at 320 px wide with no horizontal scroll (WCAG 1.4.10).

## Report

The widths you checked and the `faithful PASS` line; any width you skipped, named.
