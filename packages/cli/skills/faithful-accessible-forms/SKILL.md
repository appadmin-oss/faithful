---
name: faithful-accessible-forms
description: Build forms and custom controls that everyone can complete with mouse, keyboard, touch or screen reader — real labels, native elements, autofill, clear errors, visible focus. Use when building a signup, login, checkout, settings or search form, a custom select/dialog/menu, when asked for "accessibility", "a11y", "WCAG", "keyboard navigation", or when "the form doesn't work".
---

# Forms and controls everyone can use

Most AI-built controls are `<div onClick>` with no name, no focus and no keyboard. About
half of all home pages have unlabelled inputs (WebAIM Million 2026).

## Native first

- `<button>` for actions, `<a href>` for navigation, `<input>`/`<select>`/`<textarea>` for
  data, `<dialog>` with `showModal()` for modals. Never a `div` or `span` with a click handler.
- If you must build a custom widget, follow its WAI-ARIA Authoring Practices pattern exactly:
  role, states (`aria-expanded`, `aria-selected`), and the full keyboard model.
- Never put `aria-hidden` or `role="presentation"` on anything focusable. No ARIA is better
  than wrong ARIA.

## Every field

- A visible `<label for>`; a placeholder is not a label. Icon-only buttons get an
  `aria-label`.
- The right `type`, `inputmode` and `autocomplete` (`email`, `tel`, `postal-code`,
  `current-password`, `one-time-code`), and a stable `name` — it is the server's contract.
- Never block paste, never `user-scalable=no`, inputs at 16 px or more.

## Errors (GOV.UK pattern)

- Validate on submit, or when a field is left — never on every keystroke.
- On a failed submit: an error summary at the top that receives focus, links to each field,
  and `Error:` prefixed to the page title.
- Each message sits under its label, is tied with `aria-describedby` and
  `aria-invalid="true"`, and says how to fix it: "Enter an email address like
  name@example.com", not "Invalid input". Not colour alone.
- Keep what the user typed. Do not disable the submit button in advance; disable it only
  while submitting, and show that the click was received.

## Focus and keyboard

- A visible `:focus-visible` style (3:1 against its surroundings); never `outline: none`
  without a replacement. Nothing sticky may cover the focused field: `scroll-padding-top`.
- DOM order is visual order; no positive `tabindex`. Esc closes overlays and focus returns to
  the trigger. Targets at least 24×24 px.

## Prove it

```
npx @faithful/cli audit <form-url>
npx @faithful/cli parity --before <old-url> --after <new-url>
```

`audit` flags small targets, clipped labels and error text, unreadable sizes and wording,
and runs axe-core's WCAG 2.2 A/AA rules (`a11y` findings: missing labels, names, `autocomplete`
values, ARIA misuse). Its "needs review" note is yours to check by hand, not a pass. `parity`
proves every field name and action survived a rebuild. No tool walks the keyboard for you:
Tab through the whole form yourself, submit it empty, and submit it with one bad field: every
step must be visible and announced.

## Report

The audit and parity lines, and the keyboard walk: what you pressed and what happened.
