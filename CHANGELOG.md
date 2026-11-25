# Changelog

All notable changes to Faithful. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While Faithful is
0.x, a minor release may change what a check reports; the finding kinds (`KINDS`) are never renamed.

## [Unreleased]

The first release, `0.1.0`, will be cut from this.

### Added

- `verify <design> --build <url|file>`: a build against its design, element by element: missing
  and extra elements, copy, size, position relative to neighbours, type, colour (CIEDE2000), the
  font actually drawn, touch targets; `--scroll` for states reached by scrolling; `--screen` for
  one board of a canvas.
- Motion, declared: transitions and CSS or scripted animations compared by property, duration,
  easing, delay and repeats.
- `verify --physics`: both pages watched coming in, frame by frame; distance, time to rest,
  curve and overshoot compared, an overshoot fitted as a spring (stiffness, damping).
- `audit <url|file>`: a page with no design: layout faults at phone and desktop and under stress
  (text alone at 200%, 320px reflow, pseudo-localisation, right-to-left, WCAG 1.4.12 spacing),
  axe-core's WCAG 2.2 A/AA rules, contrast as drawn, navigation logic, dead links, agent
  leftovers, AI-slop tells by co-occurrence, copy that narrates the interface, motion that
  ignores reduced motion.
- Design sense in `audit`: the page's own type scale, spacing grid, column edges and heading
  order, fitted with a significance test, and every value that misses them with the value to use.
- Layout faults judged by what they are: a picture of UI, a frozen marquee, hidden content, a
  stacked deck, a layered heading, a floating label, each reported for what it is.
- `parity --before <a> --after <b>`: a refactor or redesign kept every link, button, field and
  route.
- `outline`, `spec`, `explain`, `guard`, `selftest`, `formats`, `doctor`, `init`, `--version`.
- `@usefaithful/mcp`: the same checks as an MCP server; fourteen Agent Skills.
- `--storage-state <file>` (and MCP `storageState`) for `verify`, `audit` and `parity`: pages
  behind a login, opened signed in.
- `data-faithful-ignore`: a region its author marks is left out of verify and audit.
- `pnpm bench`: a labelled benchmark (planted faults and known-good pages), in the test suite.

[Unreleased]: https://github.com/appadmin-oss/faithful/commits/main
