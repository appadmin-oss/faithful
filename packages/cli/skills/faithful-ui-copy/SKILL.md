---
name: faithful-ui-copy
description: Write and fix interface wording — buttons, links, headings, errors, empty states, forms — so every label says what happens, one action has one name, and nothing shouts or hides. Use when writing or reviewing UI text, when copy sounds generic or "AI-written", and when an audit reports wording findings.
---

# UI copy: say what happens

## Links and buttons

- A link says where it goes, out of context: "Read the refund policy", never "click here" or
  a row of "Learn more" to different places (a screen-reader user hears the links alone).
- A button says what it does: "Save changes", "Send my application" — not "Submit", "OK".
- One action, one name across the product: Sign in OR Log in; email OR e-mail; cart OR basket.

## Headings and text

- One capitalisation style. Sentence case reads fastest; whichever, use it everywhere.
- Specific beats grand. "Twelve plots free this spring" over "Elevate your gardening
  journey". Cut "seamless", "unlock the power", "next-level", "revolutionise".
- No shouting: no ALL-CAPS sentences, no "!!".
- Numbers carry units and real values; never a round, unsourced "10,000+ happy customers".

## Errors and empty states

- Say what happened, what is safe, and what to do: "Your card was not charged. Check the
  number and try again." Never just "Error" or "Something went wrong".
- An empty list says why it is empty and offers the next step.
- Keep what the person typed when something fails.

## Forms

- A visible label on every field (a placeholder disappears as soon as somebody types).
- A rule that will refuse input is stated before it refuses: "At least 8 characters".

## Existing copy is somebody's decision

When implementing a design, its strings are final: a wrong-looking string is a question, not
an edit. When improving copy in a redesign, record renamed controls in
`faithful.deviations.json` so the change is reviewed.

Check with `npx @usefaithful/cli audit <page>`: its `wording` findings catch vague links, generic
buttons, two names for one action, mixed heading case and doubled words.
