---
name: faithful-safe-redesign
description: Refactor a codebase into clean modules, or redesign/re-skin a product, without losing a single thing users could do. Use before any large refactor, migration, component rewrite, design overhaul or "clean this up" task on UI that already works.
---

# Safe refactor and redesign: better, and nothing lost

Agents are reported again and again for dropping features they were not asked to touch:
a menu item, a form field, a route, a delete button. This prevents it.

## Before changing anything

1. Build and serve the CURRENT version and keep it running (or save its HTML). That is
   BEFORE. Do not write tests after the change and call them proof: tests written against new
   code describe the new code.
2. Note the pages that matter (`/`, `/pricing`, `/account`, …).

## Work in small steps

Change one module, one component or one page at a time. After EVERY step:

```
npx @faithful/cli parity --before <old-url-or-file> --after <new-url-or-file> [--pages /,/account]
```

It compares what users can DO — links, buttons, form field names, landmarks, routes, script
errors — and ignores how it looks, so a full re-skin is fine.

- `lost` — users could do this before and cannot now. Put it back before going on.
- `changed` — a link or form now goes somewhere else, or sends by another method. Fix it, or
  confirm it was meant.
- `renamed` — a control kept its target but changed its name. If the rename is intended,
  record it in `faithful.deviations.json` with a reason and an owner.
- A form FIELD NAME is a contract with the server: never rename one as part of a redesign.

## Clean modules

Smaller files with one job, no cycles, no duplicated logic, no dead exports. Measure it with
the project's own tools (madge, dependency-cruiser, knip, jscpd) before and after; the count
of each may only go down.

## Improve, don't just move

A redesign should be better than what it replaces: run `npx @faithful/cli audit` on the new
pages and fix what it finds. Better looks never excuse a lost function.

## Report

The parity line from the last step, what was renamed and why, and anything you could not
keep — with the reason, for a person to decide.
