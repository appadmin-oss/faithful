/** What `faithful audit` reads off a rendered page (measured in the page by @faithful/browser). */
export interface AuditFacts {
  viewport: { width: number; height: number };
  /** The page's own address, for resolving links. */
  url: string;
  /** Filled by the renderer, not the page: script errors and requests that failed. */
  runtime?: { errors: string[]; failed: { url: string; status: number }[]; status?: number };
  scrollWidth: number;
  /** Elements that first cross the right edge, when the page scrolls sideways. */
  overflow: { sel: string; right: number; text: string }[];
  /** Text cut off by a box that hides its overflow. */
  clipped: { sel: string; text: string; axis: 'x' | 'y'; by: number }[];
  /** Two pieces of text drawn on top of each other. */
  overlaps: { a: string; b: string; text: string; other: string }[];
  /** Text in the first screen covered by something else (hit-testing its centre). */
  covered: { sel: string; text: string; by: string }[];
  brokenImages: { sel: string; src: string }[];
  /** Visible-sized text whose effective opacity is ~0: waiting for a script to reveal it. */
  invisible: { sel: string; text: string }[];
  paragraphs: { sel: string; cpl: number; lines: number; lineHeight: number; fontSize: number; centred: boolean }[];
  targets: { sel: string; text: string; w: number; h: number }[];
  /**
   * Links and buttons with what a screen reader would call them. Hidden ones are included and
   * marked: a control inside a closed menu is still something the user can do.
   */
  controls: { sel: string; role: 'link' | 'button'; name: string; href?: string; visible: boolean }[];
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
  texts: { sel: string; text: string }[];
  imageSrcs: string[];
  slop: {
    gradientText: string[];
    glass: string[];
    glow: string[];
    emojiIcons: { sel: string; text: string }[];
    sideStripes: string[];
    nestedCards: string[];
    badgeAboveH1: string | null;
    iconTiles: number;
    cardGrids: number;
    accentHues: number[];
    fonts: string[];
  };
}
