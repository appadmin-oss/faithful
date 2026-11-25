/** What `faithful audit` reads off a rendered page (measured in the page by @usefaithful/browser). */
/** Why a layout fault may not be what it looks like (see audit-probe.ts). */
export type LayoutContext = 'hidden' | 'decorative' | 'marquee' | 'stacked' | 'layered' | 'label';

export interface AuditFacts {
  viewport: { width: number; height: number };
  /** The page's own address, for resolving links. */
  url: string;
  /** Filled by the renderer, not the page: script errors and requests that failed. */
  runtime?: { errors: string[]; failed: { url: string; status: number }[]; status?: number };
  scrollWidth: number;
  /**
   * Elements that first cross the far edge, when the page scrolls sideways: the right edge,
   * or on a right-to-left page the left one (`right` is then that left edge, negative).
   */
  overflow: { sel: string; right: number; text: string }[];
  /** Text cut off by a box that hides its overflow; `side: 'left'` for right-to-left text. */
  /**
   * Text cut off by a box. `ctx` says when that is not what it looks like (audit-probe.ts,
   * "Why a layout fault may not be what it looks like"); `why` is the evidence for `decorative`.
   */
  clipped: {
    sel: string;
    text: string;
    axis: 'x' | 'y';
    by: number;
    side?: 'left';
    ctx?: LayoutContext;
    why?: string;
  }[];
  /** Two pieces of text drawn on top of each other. */
  overlaps: { a: string; b: string; text: string; other: string; ctx?: LayoutContext; why?: string }[];
  /** Text in the first screen covered by something else (hit-testing its centre). */
  covered: { sel: string; text: string; by: string; ctx?: LayoutContext }[];
  /**
   * Pictures of UI (decorative by structure) that hold controls a keyboard reaches: their
   * controls are left out of the target check and reported here, once per picture.
   */
  pictures?: { sel: string; why: string; controls: number }[];
  brokenImages: { sel: string; src: string }[];
  /** Visible-sized text whose effective opacity is ~0: waiting for a script to reveal it. */
  invisible: { sel: string; text: string }[];
  paragraphs: { sel: string; cpl: number; lines: number; lineHeight: number; fontSize: number; centred: boolean }[];
  /**
   * Controls under 24px in either dimension (links inside running text excluded). `spaced`:
   * WCAG 2.5.8's spacing exception holds (a 24px circle on its centre meets no other target).
   */
  targets: { sel: string; text: string; w: number; h: number; spaced?: boolean }[];
  /**
   * Links and buttons with what a screen reader would call them. Hidden ones are included and
   * marked: a control inside a closed menu is still something the user can do.
   */
  controls: { sel: string; role: 'link' | 'button'; name: string; href?: string; visible: boolean }[];
  /**
   * Navigation landmarks outside the footer: their entries (name, destination, whether marked
   * as the current page, whether a logo) and `strip`, the most entries in one list of the menu.
   * Optional: facts recorded before this was measured have none, and nothing is judged.
   */
  navs?: {
    sel: string;
    label: string;
    entries: { sel: string; name: string; href?: string; visible: boolean; current?: boolean; logo?: boolean }[];
    strip: number;
  }[];
  /** Links that go nowhere: `#`, empty, `javascript:`, or `#id` with no such id. Optional for older facts. */
  deadLinks?: { sel: string; name: string; href: string }[];
  /**
   * The page's own values with how often each is used (most first): colours (hex) of text,
   * fills and borders; text sizes; box radii; and each filled button's shape and type.
   * Optional for older facts.
   */
  palette?: {
    colors: [string, number][];
    sizes: [number, number][];
    radii: [number, number][];
    buttons: { sel: string; text: string; radius: number; height: number; fontSize: number; fontWeight: number }[];
  };
  /**
   * The document's own title and meta description, and whether it has a viewport meta tag.
   * Optional for older facts.
   */
  doc?: { title: string; description: string; viewportMeta?: boolean };
  /**
   * Every element that still moves with `prefers-reduced-motion: reduce` (the audit's own
   * setting), with its transitions (`t`), CSS animations (`a`) and scripted ones (`s`). Filled by
   * the renderer; absent in stress passes and in older facts.
   */
  reducedMotion?: {
    sel: string;
    reading: {
      t: { p: string; d: number; e: string }[];
      a: { p: string; d: number; e: string; i?: string; k?: string }[];
      s: { p: string; d: number; e: string; i?: string; k?: string }[];
    };
  }[];
  /** The device the page was rendered as (filled by the renderer). */
  device?: 'phone' | 'tablet' | 'desktop';
  /** Every form: where it sends, how, and the names the server will read. */
  forms: {
    sel: string;
    action: string;
    method: string;
    fields: { name: string; type: string; required: boolean; label: string }[];
    submits: string[];
  }[];
  /** ARIA landmark roles present (banner, navigation, main, contentinfo, search, …). */
  landmarks: string[];
  headings: { sel: string; level: number; text: string }[];
  fontSizes: number[];
  /**
   * Each visible text's colour and the colour behind it, both as DRAWN (alpha, background
   * layers and every ancestor's opacity composited), as sRGB triples. Judged by `scoreAudit`.
   * `shadow`: the text has a shadow or stroke, which may be what makes it readable.
   */
  textColors?: {
    sel: string;
    text: string;
    fg: [number, number, number];
    bg: [number, number, number];
    size: number;
    weight: number;
    shadow?: boolean;
  }[];
  /**
   * Texts whose background could not be resolved to one colour (an image, a gradient, a video,
   * a filter or blend, another box painted under the words): never judged, never a pass.
   */
  contrastUnknown?: { n: number; sel?: string; why?: string };
  /**
   * Dark preference, the page has `prefers-color-scheme: dark` styles, but its root never
   * opted into `color-scheme: dark`: native form controls drawn light on a dark surface.
   */
  lightControls?: { n: number; sel: string };
  /**
   * axe-core's WCAG 2.2 A/AA rules, run by the renderer (not the probe): what failed, what it
   * could not decide ("needs review"), or why it could not run. Absent when axe was switched off.
   */
  axe?: AxeFacts;
  texts: { sel: string; text: string }[];
  imageSrcs: string[];
  slop: {
    gradientText: string[];
    glass: string[];
    glow: string[];
    emojiIcons: { sel: string; text: string }[];
    sideStripes: string[];
    /** Boxes carrying three or more decorative layers at once (gradient, glow, blur, ring, ornament). */
    stacked?: string[];
    /** Labels directly above a heading that only repeat the heading's words. */
    restated?: string[];
    /** Each heading and the prose under it (and the card grid it sits in): the narration check. */
    blurbs?: { sel: string; heading: string; text: string; grid?: string }[];
    nestedCards: string[];
    badgeAboveH1: string | null;
    iconTiles: number;
    cardGrids: number;
    accentHues: number[];
    fonts: string[];
  };
}

/** One axe-core rule's result, trimmed to what a finding needs. */
export interface AxeRule {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  help: string;
  helpUrl: string;
  /** How many elements the rule flagged, and the first one's selector. */
  n: number;
  sel: string;
}

export type AxeFacts = { violations: AxeRule[]; incomplete: AxeRule[] } | { error: string };
