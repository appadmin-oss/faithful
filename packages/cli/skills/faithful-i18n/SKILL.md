---
name: faithful-i18n
description: Build UI that survives translation and right-to-left scripts, and prove it — text 30–100% longer, Arabic/Hebrew layout, WCAG text spacing, locale-aware numbers and dates. Use when adding a language, localising, supporting RTL, fixing labels cut off in another language, or before shipping UI that will be translated.
---

# Internationalisation: proven under longer text, RTL and user spacing

English is short and left-to-right. The same button in German, the same header in Arabic,
the same card with a reader's own text spacing is where generated UI breaks: fixed widths
clip, `left:` offsets point the wrong way, numbers are glued together by hand.

## Check it

```
npx @faithful/cli audit <url-or-file> --stress expand,rtl,spacing
```

Each pass runs on top of the normal one, per viewport (`audit@375 expand`, `audit@375 rtl`,
`audit@375 spacing`), and reports only the clipped text, overlaps and sideways scroll it ADDS,
saying what caused it ("with text 1.3–2× longer", "in right-to-left", "with WCAG 1.4.12 text
spacing"). `expand` pseudo-localises every visible string in place ("Save" → "Šàvé ŀŏŕé").
An `unmeasured` note means the page refused a pass: that is not a pass. Fix every error and
re-run until it passes.

## Rules

1. **Declare language and direction on `<html>`**: `<html lang="ar" dir="rtl">`. Use the
   `dir` attribute, never CSS `direction`: markup direction survives without CSS and drives
   bidi, form controls and screen readers. Source: W3C, "Structural markup and right-to-left
   text in HTML" (https://www.w3.org/International/questions/qa-html-dir).
2. **User-supplied text gets `dir="auto"`** (inputs, comments, names), and inline user text
   inside a sentence is wrapped in `<bdi>` so a Hebrew name does not reorder the punctuation
   around it (same source).
3. **Logical properties, not physical ones**: `margin-inline-start`, `padding-inline-end`,
   `inset-inline-start`, `border-inline-start`, `text-align: start`. A `left: -200px` menu or a
   `margin-left` gap is the classic RTL fault the `rtl` pass finds. Flexbox and grid already
   follow `dir`; do not reverse them by hand.
4. **Mirror directional icons only**: arrows, back/forward chevrons, progress and "reply"
   icons flip (`:dir(rtl) .icon-forward { transform: scaleX(-1) }`). Logos, media play
   buttons, checkmarks, clocks and anything that depicts a real object do not.
5. **Leave room to grow.** Translations from English run longer: up to 10 characters
   200–300%, 11–20 180–200%, 21–30 160–180%, 31–50 140–160%, 51–70 151–170%, over 70 130%
   (W3C, "Text size in translation",
   https://www.w3.org/International/articles/article-text-size). The `expand` pass uses
   200/180/160/140%, and 130% over 50: a floor, so passing it is not a ceiling.
6. **No fixed widths on buttons, tabs, labels, badges or menus.** Use `min-width`, padding
   and `min-height`; let rows wrap (`flex-wrap: wrap`). Truncate with an ellipsis only where a
   tooltip or the full text is available elsewhere.
7. **Long compound words wrap**: `overflow-wrap: anywhere` (or `break-word`) on narrow
   containers, so "Datenschutzeinstellungen" does not push the page sideways; add `hyphens:
   auto` where `lang` is set.
8. **Unitless `line-height`** (`1.5`, not `24px`), and never a fixed `height` on a text box:
   scripts such as Thai, Devanagari and Arabic need taller lines, and so does a reader's own
   spacing (rule 11).
9. **Never concatenate translated strings** (`t('Hello') + name + t('!')`) or assume English
   word order: pass whole messages with placeholders to the translator, and pluralise with
   the message format, not `count === 1 ? … : …`.
10. **Format with `Intl`, never by hand**: `Intl.NumberFormat` (numbers, currency, units),
    `Intl.DateTimeFormat` (dates, times, time zones), `Intl.PluralRules` (plural categories:
    Arabic has six), `Intl.RelativeTimeFormat`, `Intl.ListFormat`. Source: MDN `Intl`
    (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl).
11. **Survive the reader's text spacing (WCAG 2.2 SC 1.4.12)**: line height 1.5×, paragraph
    spacing 2×, letter spacing 0.12×, word spacing 0.16× the font size, with nothing cut off
    or overlapping (https://www.w3.org/WAI/WCAG22/Understanding/text-spacing). That is
    exactly what the `spacing` pass applies.
12. **No text in images.** It cannot be translated, resized or read aloud; use real text over
    the image (and check its contrast with `audit`).

## Done means

- `npx @faithful/cli audit <url> --stress expand,rtl,spacing` passes on every page you
  changed, at phone and desktop width (paste the line as proof).
- Any `unmeasured` note was explained, and the real translations were checked by eye in the
  longest language you ship.
