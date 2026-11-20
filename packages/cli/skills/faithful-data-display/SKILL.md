---
name: faithful-data-display
description: Build dashboards, tables, KPI cards and charts that stay readable with real data — aligned numbers, proper formatting, honest empty and error states, no fake figures. Use when asked to "build a dashboard", "data table", "admin panel", "KPI cards", "charts", or when numbers don't line up, columns overflow, or the data looks made up.
---

# Data display: real numbers, readable

Dashboards are where generated UI fails quietly: invented metrics, `NaN%`, a table that
scrolls the whole page, and numbers that jump around as they update.

## Content

- Never invent data, trends, customers or percentages. Use the real source, a fixture the
  owner provided, or a clearly labelled empty state.
- Every number has its unit and period: "€12,400 · last 30 days", not "12.4K".
- Format with `Intl.NumberFormat` / `Intl.DateTimeFormat` for the user's locale; never
  `toFixed()` plus a hand-placed "$". Keep a value and its unit together with a non-breaking
  space.
- Division by zero, missing values and nulls render as `—` with a reason on hover, never
  `NaN`, `Infinity` or `undefined`.

## Layout

- `font-variant-numeric: tabular-nums` and right alignment for numbers people compare.
- Wide tables scroll inside their own container with a sticky header and first column;
  the page itself never scrolls sideways.
- Truncate long labels with an ellipsis and show the full value on hover and focus.
- Status is never colour alone: add a word or an icon with a text alternative.
- Charts have a title, axis labels with units, and a text summary or table for screen readers.
- Sort, filter and page live in the URL, so refresh, share and Back work.
- Loading keeps the layout (skeleton rows of the final height); empty and error states say
  what happened and what to do.

## Prove it

```
npx @faithful/cli audit <dashboard-url> --viewports 375x812,1440x900
```

It flags unrendered values, placeholder or dummy data, clipped cells, overlapping labels and
sideways scroll. Audit the empty and error states too (see `faithful-ui-states`). With a
design, also run `npx @faithful/cli verify <design> --build <dashboard-url>`.

## Report

The audit line per state and width, and where each figure on screen comes from.
