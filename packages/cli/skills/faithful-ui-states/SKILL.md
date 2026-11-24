---
name: faithful-ui-states
description: Build and prove every state of a screen, not just the happy path — loading, empty, error, no permission, one item, a thousand items, very long names, slow network. Use when a view shows data, when asked to "handle edge cases", "what if there's no data", "make it production-ready", when long names break a layout, or before calling any data-bound screen done.
---

# Every state, not just the happy path

Generated UI ships the screen with perfect data. Users meet the other states first: the
spinner, the empty account, the failed request, the name that is 60 characters long.

## 1. Write the state matrix first

For each data-bound view, list the states before building, and give each one a URL, a story
or a fixture that shows it (`?state=empty`, a Storybook story, a mock-server switch):

| State | What the user must see |
|---|---|
| loading | a skeleton the shape of the result; no "No results" while still loading |
| empty (first use) | why it is empty and the one action that fills it |
| empty (filtered) | that the filter caused it, and how to clear it |
| error | what failed in plain words, and Retry; never a raw message or stack |
| no permission | who can grant access; not a blank page |
| one / many / huge | one item looks deliberate; 1,000 items paginate or virtualise |
| worst-case content | 60-character names, 3-line titles, missing images, 0 and negative numbers |
| slow | feedback within 100 ms of any action; no double submit |

Controls have states too: hover, focus-visible, active, disabled, busy, selected.

## 2. Rules

- Show a spinner only after a short delay (about 300 ms) so fast loads do not flash.
- Never render `undefined`, `NaN`, `null`, `[object Object]` or `{{ x }}`: fall back to `—`
  or an explicit empty state.
- Text in a fixed-width box truncates with an ellipsis and a full value on focus/hover, or
  wraps; it never spills over its neighbour.
- Error copy says what happened and what to do next: "We couldn't load your invoices. Retry."
- Keep what the user typed when a request fails.

## 3. Prove each state

Run the audit on EVERY state URL, at phone and desktop width:

```
npx @usefaithful/cli audit "http://localhost:3000/orders?state=empty"
npx @usefaithful/cli audit "http://localhost:3000/orders?state=error"
```

It catches clipped and overlapping text, sideways scroll, unrendered values, placeholder data
and broken images in that state. If the design has a board per state, also run
`npx @usefaithful/cli verify <design> --build <state-url>` for each.

## Report

The matrix, with the state URL and the `faithful PASS` line for each row. A state you could
not reach is listed as not proven, never as done.
