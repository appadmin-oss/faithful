/**
 * The Faithful design spec.
 *
 * One shape that every adapter reads INTO (a Claude Design handoff, a Figma file, an HTML
 * prototype, a screenshot, a token file) and every check reads FROM. Keeping it small and
 * versioned is what lets the readers change — a design tool reshapes its export — without the
 * verifier, the guards or an agent's prompt having to change with it.
 *
 * Coordinates are CSS pixels, origin at the top left of the screen's viewport, the page
 * scrolled to the top. Colours are CSS strings as the source gave them; `@usefaithful/core`
 * normalises them. Lengths in `style` are pixels.
 */

/** The spec version. Bump only on a breaking change; adapters write it, readers check it. */
export const SPEC_VERSION = 1 as const;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ElementKind = 'text' | 'box' | 'image' | 'control';

/** The computed or designed look of one element. Every field optional: a source says what it knows. */
export interface ElementStyle {
  color?: string;
  background?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  lineHeight?: number;
  letterSpacing?: number;
  textTransform?: string;
  radius?: number;
  borderColor?: string;
  borderWidth?: number;
  opacity?: number;
  /**
   * The face the browser actually DREW the text with (DevTools' platform fonts). When it is
   * not the family asked for, the design font failed to load and a fallback stood in.
   */
  renderedFont?: string;
}

export interface DesignElement {
  /** Stable within the spec. For a rendered page, a short CSS path; for Figma, the node id. */
  id: string;
  kind: ElementKind;
  /** Visible text, as written. Present for text and labelled controls. */
  text?: string;
  /** Absent when the source cannot place it (a template read without rendering). */
  box?: Box;
  style?: ElementStyle;
  /** ARIA role or the HTML element's implicit role, when known. */
  role?: string;
  /** The region (landmark, labelled section, Figma frame) this element belongs to. */
  region?: string;
  /** Interactive: needs a touch target. */
  interactive?: boolean;
}

export interface Region {
  id: string;
  name: string;
  box?: Box;
}

export interface Viewport {
  width: number;
  height: number;
  /** The kind of device the width stands for; default from the width (`deviceOf`). */
  device?: Device;
}

/**
 * Which device a viewport is. A phone or a tablet has touch and no hover, so a page's
 * `(hover: none)` and `(pointer: coarse)` rules apply there; a 390px desktop window is not a
 * phone, and checking one as if it were reads the wrong design.
 */
export type Device = 'phone' | 'tablet' | 'desktop';

/** Under 768px a phone, under 1024px a tablet, else a desktop, unless the viewport says. */
export function deviceOf(v: Viewport): Device {
  return v.device ?? (v.width < 768 ? 'phone' : v.width < 1024 ? 'tablet' : 'desktop');
}

export interface Screen {
  id: string;
  name: string;
  viewport: Viewport;
  elements: DesignElement[];
  regions?: Region[];
  /** A picture of the design, when the source is (or includes) an image. Path or data URL. */
  referenceImage?: string;
  /** Full height of the page or frame, when it scrolls. */
  pageHeight?: number;
  /** Families the page declares as web fonts (@font-face), so a failed load can be told apart. */
  fontFaces?: string[];
}

export type TokenType = 'color' | 'dimension' | 'fontFamily' | 'fontWeight' | 'number' | 'duration' | 'other';

export interface Token {
  /** Dotted path, as DTCG writes it: `color.brand.primary`. */
  name: string;
  type: TokenType;
  /** Resolved value (aliases followed). */
  value: string | number;
}

/**
 * What a design USES, without saying where: its palette, its type sizes, its radii, its copy.
 * Enough to check a build's style against a design that could not be placed — a template read
 * without its runtime, a token file, a DESIGN.md.
 */
export interface Inventory {
  colors: string[];
  fontSizes: number[];
  fontFamilies: string[];
  radii: number[];
  texts: string[];
}

/** How sure a reader was, so a report can say how much to trust a comparison. */
export type Tier = 'structured' | 'rendered' | 'static' | 'vector' | 'image';

export interface Provenance {
  /** The adapter that read it, e.g. `dc-html`. */
  adapter: string;
  adapterVersion: string;
  /** The format and version the adapter recognised, e.g. `claude-design/dc@1`. */
  format: string;
  tier: Tier;
  /** 0–1. Below 0.5 the report says the comparison is indicative only. */
  confidence: number;
  /** The path or URL read. */
  source: string;
  /** Things the reader could not understand and kept going past. Never silently dropped. */
  warnings: string[];
}

export interface FaithfulSpec {
  faithful: typeof SPEC_VERSION;
  provenance: Provenance;
  screens: Screen[];
  tokens?: Token[];
  inventory?: Inventory;
  /** Anything a reader saw and has no field for: kept, not dropped (DTCG's rule for $extensions). */
  extensions?: Record<string, unknown>;
}

export class SpecError extends Error {
  override readonly name = 'SpecError';
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function checkBox(b: unknown, at: string): void {
  if (!isObj(b) || !isNum(b.x) || !isNum(b.y) || !isNum(b.w) || !isNum(b.h)) {
    throw new SpecError(`${at}: box must have numeric x, y, w, h`);
  }
  if (b.w < 0 || b.h < 0) throw new SpecError(`${at}: box width and height cannot be negative`);
}

/**
 * Check a parsed JSON value is a Faithful spec this version can read, and return it typed.
 * Hand-written rather than a schema library: the spec package has no dependencies, so anything
 * can read a spec without pulling a tree in.
 */
export function validateSpec(value: unknown): FaithfulSpec {
  if (!isObj(value)) throw new SpecError('spec must be an object');
  if (value.faithful !== SPEC_VERSION) {
    throw new SpecError(
      `spec version ${String(value.faithful)} is not supported (this reader understands ${SPEC_VERSION})`,
    );
  }
  const p = value.provenance;
  if (!isObj(p) || typeof p.adapter !== 'string' || typeof p.format !== 'string' || typeof p.tier !== 'string') {
    throw new SpecError('provenance must name the adapter, format and tier');
  }
  if (!Array.isArray(value.screens)) throw new SpecError('screens must be an array');
  value.screens.forEach((s, i) => {
    const at = `screens[${i}]`;
    if (!isObj(s) || typeof s.id !== 'string') throw new SpecError(`${at}: needs an id`);
    if (!isObj(s.viewport) || !isNum(s.viewport.width) || !isNum(s.viewport.height)) {
      throw new SpecError(`${at}: viewport must have numeric width and height`);
    }
    if (!Array.isArray(s.elements)) throw new SpecError(`${at}: elements must be an array`);
    s.elements.forEach((e, j) => {
      const eat = `${at}.elements[${j}]`;
      if (!isObj(e) || typeof e.id !== 'string' || typeof e.kind !== 'string')
        throw new SpecError(`${eat}: needs id and kind`);
      if (e.box !== undefined) checkBox(e.box, eat);
    });
  });
  return value as unknown as FaithfulSpec;
}

/** An empty inventory, for adapters to fill. */
export function emptyInventory(): Inventory {
  return { colors: [], fontSizes: [], fontFamilies: [], radii: [], texts: [] };
}
