---
name: faithful-dark-mode
description: Build a dark theme that is readable and complete, and prove it in both themes — contrast, native controls, shadows, icons and the theme toggle. Use when adding or fixing dark mode, a theme toggle or prefers-color-scheme styles, when text "disappears" or form fields stay white in dark mode, or before shipping any change to colours.
---

# Dark mode: both themes, proven

A dark theme is a second design, not an inverted one. Generated dark themes usually swap the
page background and forget everything else: grey text that was fine on white, white form
fields, shadows that vanish, black icons on black.

## Check both themes

```
npx @usefaithful/cli audit <url-or-file> --color-scheme both
```

Every viewport is rendered in light and in dark; findings name the screen (`audit@375 dark`).
Fix every error, then re-run until it passes. With a design, check the dark board too:
`npx @usefaithful/cli verify <design> --build <url> --color-scheme dark`.

`contrast` findings are grouped by colour pair: one fix to a token clears every text using it.
A "not judged" note (text over an image, a gradient, a video, a blend) is never a pass: check
those by eye in both themes.

## Rules

1. **Declare the schemes the page supports**, so the browser draws native controls,
   scrollbars and the default canvas to match: `:root { color-scheme: light dark; }` and
   `<meta name="color-scheme" content="light dark">` in the head (the meta applies before the
   CSS loads, so there is no white flash). Source: MDN `color-scheme`
   (https://developer.mozilla.org/en-US/docs/Web/CSS/color-scheme). Without it, `audit`
   reports native form controls drawn light on a dark page.
2. **Swap semantic tokens, never components.** Name colours by role (`--surface`, `--text`,
   `--text-muted`, `--border`, `--accent`) and redefine only those per theme, in one place.
   A component that names a raw colour, or has its own `@media (prefers-color-scheme)` block,
   will be missed next time. `npx @usefaithful/cli guard` catches raw colours.
3. **Give `body` an explicit background and text colour in both themes.** The default canvas
   differs between browsers and schemes; never rely on it.
4. **Contrast in both themes:** text 4.5:1, large text (24px, or bold 18.66px) 3:1 (WCAG 2.2
   SC 1.4.3, https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum); icons, input
   borders and focus rings 3:1 against what is next to them (SC 1.4.11,
   https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast). Muted text is where dark
   themes fail first: re-pick it for the dark surface, do not reuse the light value.
5. **Avoid pure black and pure white.** A near-black surface (#121212-ish) with off-white
   text reads better and leaves room for elevation.
6. **Re-tune shadows and borders.** A shadow is invisible on a dark surface: show elevation
   with a lighter surface or a subtle border instead, and check borders still separate.
7. **Icons and SVGs use `currentColor`** (`fill="currentColor"` / `stroke="currentColor"`),
   so they follow the text colour. A hard-coded `#000` icon disappears in dark.
8. **Images:** give transparent PNG logos a dark-safe variant (`<picture>` with
   `media="(prefers-color-scheme: dark)"`); do not dim photos with `filter` on the content.
9. **A manual toggle overrides the system in both directions.** Store the choice, set it as
   `data-theme="light|dark"` on `<html>` before first paint (an inline script in the head),
   and write the dark tokens so they apply for `[data-theme=dark]` AND for the system
   preference when no choice is stored — and the light tokens for `[data-theme=light]` even
   when the system is dark. Set `color-scheme` to match the chosen theme.
10. **Charts, code blocks, embeds and third-party widgets** have their own colours: check each.

## Done means

- `npx @usefaithful/cli audit <url> --color-scheme both` passes on every page you changed (paste
  the line as proof), and any "not judged" texts were checked by eye.
- The toggle was tried both ways against both system settings.
