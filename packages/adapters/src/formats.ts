/**
 * The readers that need no browser: a Faithful spec itself (what a design agent emits), design
 * tokens (DTCG JSON, CSS custom properties, Tailwind v4 `@theme`), a copy deck, a DESIGN.md,
 * a Figma REST export, and a reference image.
 *
 * Each one says honestly what it could not do. A token file has no layout, so it yields an
 * INVENTORY (a palette, a type scale, faces, radii) and the verifier checks conformity rather
 * than placement; an image without a sidecar spec has no elements, so its confidence is low and
 * the report says the comparison is indicative.
 */
import type { Adapter } from '@faithful/core';
import { parseColor, toHex } from '@faithful/core';
import type { DesignElement, Inventory, Screen, Token } from '@faithful/spec';
import { emptyInventory, SpecError, validateSpec } from '@faithful/spec';
import { mergeInventory, provenance, screenId, spec } from './util.js';

/** A malformed design file: the error names the file, and the run stops with exit 2. */
async function readJson(ctx: { readFile(p: string): Promise<string> }, path: string, what: string): Promise<unknown> {
  const text = await ctx.readFile(path);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new SpecError(`${path}: not valid JSON, so not a ${what} (${(e as Error).message})`);
  }
}
async function about<T>(path: string, what: string, read: () => T | Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    throw new SpecError(msg.startsWith(path) ? msg : `${path}: not a valid ${what}: ${msg}`);
  }
}

// ── A Faithful spec ──────────────────────────────────────────────────────────

export const specAdapter: Adapter = {
  name: 'faithful-spec',
  version: '0.1.0',
  describes: 'A Faithful spec (*.faithful.json), as written by a design agent or `faithful spec`',
  sniff(input) {
    if (input.isUrl) return null;
    return /"faithful"\s*:\s*1\b/.test(input.head.slice(0, 2000)) ? { format: 'faithful/spec@1', confidence: 1 } : null;
  },
  async read(input, ctx) {
    const doc = await readJson(ctx, input.path, 'Faithful spec');
    return about(input.path, 'Faithful spec', () => validateSpec(doc));
  },
};

// ── Tokens ───────────────────────────────────────────────────────────────────

const px = (v: string | number): number | null => {
  if (typeof v === 'number') return v;
  const m = /^(-?\d*\.?\d+)(px|rem)?$/.exec(v.trim());
  if (!m) return null;
  const n = Number.parseFloat(m[1] as string);
  return m[2] === 'rem' ? n * 16 : n;
};

function classify(name: string, value: string | number, declared?: string): Token['type'] {
  const n = name.toLowerCase();
  if (declared === 'color' || (typeof value === 'string' && parseColor(value))) return 'color';
  if (declared === 'fontFamily' || /font-?family|font\.family|typeface/.test(n)) return 'fontFamily';
  if (declared === 'fontWeight' || /weight/.test(n)) return 'fontWeight';
  if (declared === 'duration' || /duration|motion|ms$/.test(n)) return 'duration';
  if (declared === 'dimension' || (typeof value === 'string' && /^-?\d*\.?\d+(px|rem)$/.test(value.trim())))
    return 'dimension';
  return typeof value === 'number' ? 'number' : 'other';
}

/** An inventory from tokens: colours, the font sizes and radii a name says they are, faces. */
export function inventoryFromTokens(tokens: Token[]): Inventory {
  const inv = emptyInventory();
  for (const t of tokens) {
    const n = t.name.toLowerCase();
    if (t.type === 'color') {
      const c = parseColor(String(t.value));
      if (c && c.a > 0) inv.colors.push(toHex(c));
    } else if (t.type === 'fontFamily')
      inv.fontFamilies.push(
        String(t.value)
          .split(',')[0]
          ?.trim()
          .replace(/^['"]|['"]$/g, '')
          .toLowerCase() ?? '',
      );
    else if (t.type === 'dimension') {
      const v = px(t.value);
      if (v === null) continue;
      // DTCG nests with dots (`font.size.body`), CSS with dashes (`--font-size-body`).
      if (/font[-.]?size|(^|[.-])fs([.-]|$)|text|type/.test(n)) inv.fontSizes.push(v);
      else if (/radius|rounded|(^|[.-])r([.-]|$)/.test(n)) inv.radii.push(v);
    }
  }
  return mergeInventory(emptyInventory(), inv);
}

/** DTCG (`$value`/`$type`, nested groups, `{alias.refs}`), resolved. */
export function tokensFromDtcg(doc: unknown): Token[] {
  const flat = new Map<string, { value: unknown; type?: string }>();
  const walk = (node: unknown, path: string[], inherited?: string) => {
    if (typeof node !== 'object' || node === null) return;
    const o = node as Record<string, unknown>;
    const type = typeof o.$type === 'string' ? o.$type : inherited;
    if ('$value' in o) {
      flat.set(path.join('.'), type === undefined ? { value: o.$value } : { value: o.$value, type });
      return;
    }
    for (const [k, v] of Object.entries(o)) if (!k.startsWith('$')) walk(v, [...path, k], type);
  };
  walk(doc, []);
  const resolve = (v: unknown, depth = 0): unknown => {
    if (depth > 10 || typeof v !== 'string') return v;
    const m = /^\{([^}]+)\}$/.exec(v.trim());
    return m ? resolve(flat.get(m[1] as string)?.value, depth + 1) : v;
  };
  const out: Token[] = [];
  for (const [name, { value, type }] of flat) {
    let v = resolve(value);
    // DTCG 2025.10 colours may be objects: { colorSpace, components, hex }.
    if (typeof v === 'object' && v !== null && 'hex' in v) {
      v = (v as { hex: unknown }).hex;
      if (typeof v !== 'string') throw new SpecError(`token "${name}": a colour's "hex" must be a string`);
    }
    if (typeof v === 'object' && v !== null && 'value' in v && 'unit' in v)
      v = `${(v as { value: number }).value}${(v as { unit: string }).unit}`;
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    out.push({ name, type: classify(name, v, type), value: v });
  }
  return out;
}

/** CSS custom properties (`--x: value`), including Tailwind v4 `@theme`, var() resolved. */
export function tokensFromCss(css: string): Token[] {
  const raw = new Map<string, string>();
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g))
    raw.set(m[1] as string, (m[2] as string).trim());
  const resolve = (v: string, depth = 0): string =>
    depth > 10
      ? v
      : v.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_, n: string, fb?: string) =>
          resolve(raw.get(n) ?? fb ?? '', depth + 1),
        );
  return [...raw].map(([name, v]) => {
    const value = resolve(v);
    return { name: name.slice(2), type: classify(name, value), value };
  });
}

export const tokensAdapter: Adapter = {
  name: 'tokens',
  version: '0.1.0',
  describes: 'Design tokens: DTCG JSON (*.tokens.json), CSS custom properties, Tailwind v4 @theme',
  sniff(input) {
    if (input.isUrl) return null;
    if (/\.json$/i.test(input.path) && /"\$value"\s*:/.test(input.head))
      return { format: 'dtcg@2025.10', confidence: 0.9 };
    if (/\.css$/i.test(input.path)) {
      const n = (input.head.match(/--[\w-]+\s*:/g) ?? []).length;
      const rules = (input.head.match(/[^{};]+\{/g) ?? []).length;
      if (n >= 5 && n >= rules * 3)
        return { format: /@theme\b/.test(input.head) ? 'tailwind/theme@4' : 'css/custom-properties', confidence: 0.75 };
    }
    return null;
  },
  async read(input, ctx) {
    const json = /\.json$/i.test(input.path);
    const text = json ? '' : await ctx.readFile(input.path);
    const tokens = json
      ? await about(input.path, 'DTCG token file', async () =>
          tokensFromDtcg(await readJson(ctx, input.path, 'DTCG token file')),
        )
      : tokensFromCss(text);
    const fmt = /\.json$/i.test(input.path)
      ? 'dtcg@2025.10'
      : /@theme\b/.test(text)
        ? 'tailwind/theme@4'
        : 'css/custom-properties';
    const warnings = tokens.length ? [] : ['no tokens found'];
    return spec(provenance('tokens', fmt, 'static', 0.6, input.path, warnings), [], {
      tokens,
      inventory: inventoryFromTokens(tokens),
    });
  },
};

// ── A copy deck: every visible string, one per line ─────────────────────────

export const copyDeckAdapter: Adapter = {
  name: 'copy-deck',
  version: '0.1.0',
  describes: 'A copy deck (*.txt): every visible string of a design, one per line',
  sniff(input) {
    if (input.isUrl || !/\.txt$/i.test(input.path)) return null;
    const lines = input.head.split(/\r?\n/).filter((l) => l.trim());
    return lines.length >= 3 ? { format: 'copy-deck@1', confidence: 0.55 } : null;
  },
  async read(input, ctx) {
    const texts = (await ctx.readFile(input.path))
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    return spec(provenance('copy-deck', 'copy-deck@1', 'static', 0.5, input.path), [], {
      inventory: { ...emptyInventory(), texts: [...new Set(texts)] },
    });
  },
};

// ── DESIGN.md (Stitch and hand-written) ──────────────────────────────────────

export const designMdAdapter: Adapter = {
  name: 'design-md',
  version: '0.1.0',
  describes: 'DESIGN.md: a written design system (colours, type, radii) read into an inventory',
  sniff(input) {
    if (input.isUrl || !/\.md$/i.test(input.path)) return null;
    const named = /(^|\/)design\.md$/i.test(input.path);
    const hexes = (input.head.match(/#[0-9a-f]{6}\b/gi) ?? []).length;
    if (!named && hexes < 3) return null;
    return { format: 'design-md@1', confidence: named ? 0.7 : 0.4 };
  },
  async read(input, ctx) {
    const md = await ctx.readFile(input.path);
    const inv = emptyInventory();
    for (const m of md.matchAll(/(?<![&\w])#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
      const c = parseColor(m[0]);
      if (c) inv.colors.push(toHex(c));
    }
    for (const m of md.matchAll(/(?:font[- ]?size|size|text)[^\n|]{0,40}?(\d+(?:\.\d+)?)px/gi))
      inv.fontSizes.push(Number.parseFloat(m[1] as string));
    for (const m of md.matchAll(/(?:radius|rounded|corner)[^\n|]{0,40}?(\d+(?:\.\d+)?)px/gi))
      inv.radii.push(Number.parseFloat(m[1] as string));
    // The keyword is matched in either case ("Typeface:" opens a line); the name must start
    // with a capital, which is what keeps prose like "font: see below" out.
    for (const m of md.matchAll(
      /(?:[Ff]ont[- ]?[Ff]amily|[Tt]ypeface|[Ff]ont)\s*[:|-]\s*[`"']?([A-Z][\w ]{2,30}?)[`"',|\n(]/g,
    ))
      inv.fontFamilies.push((m[1] as string).trim().toLowerCase());
    const out = mergeInventory(emptyInventory(), inv);
    const warnings = out.colors.length ? [] : ['no colours found; is this a design system?'];
    return spec(provenance('design-md', 'design-md@1', 'static', 0.4, input.path, warnings), [], { inventory: out });
  },
};

// ── Figma REST export (GET /v1/files/:key or /nodes) ─────────────────────────

type FNode = {
  id: string;
  name?: string;
  type: string;
  visible?: boolean;
  characters?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  fills?: Array<{
    type: string;
    visible?: boolean;
    opacity?: number;
    color?: { r: number; g: number; b: number; a: number };
  }>;
  strokes?: FNode['fills'];
  strokeWeight?: number;
  cornerRadius?: number;
  style?: {
    fontFamily?: string;
    fontWeight?: number;
    fontSize?: number;
    lineHeightPx?: number;
    letterSpacing?: number;
    textCase?: string;
  };
  opacity?: number;
  children?: FNode[];
};

const rgba = (f: NonNullable<FNode['fills']>[number] | undefined): string | undefined => {
  if (!f || f.visible === false || f.type !== 'SOLID' || !f.color) return undefined;
  const a = (f.color.a ?? 1) * (f.opacity ?? 1);
  const c = (v: number) => Math.round(v * 255);
  return `rgba(${c(f.color.r)}, ${c(f.color.g)}, ${c(f.color.b)}, ${Math.round(a * 1000) / 1000})`;
};

/** Figma frames as screens: every visible text, painted shape and image fill, frame-relative. */
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isBox = (b: unknown): boolean =>
  isObj(b) && ['x', 'y', 'width', 'height'].every((k) => typeof b[k] === 'number' && Number.isFinite(b[k]));

/** Check the parts of a Figma node this reader relies on, so a malformed file is named, not a TypeError. */
function checkNode(n: unknown, at: string): asserts n is FNode {
  if (!isObj(n) || typeof n.type !== 'string') throw new SpecError(`${at} is not a node (no "type")`);
  if (n.children !== undefined && !Array.isArray(n.children)) throw new SpecError(`${at}.children is not a list`);
  if (n.characters !== undefined && typeof n.characters !== 'string')
    throw new SpecError(`${at}.characters is not text`);
  if (n.absoluteBoundingBox !== undefined && n.absoluteBoundingBox !== null && !isBox(n.absoluteBoundingBox))
    throw new SpecError(`${at}.absoluteBoundingBox needs numeric x, y, width, height`);
  for (const k of ['fills', 'strokes'] as const)
    if (n[k] !== undefined && !Array.isArray(n[k])) throw new SpecError(`${at}.${k} is not a list`);
  if (n.style !== undefined && !isObj(n.style)) throw new SpecError(`${at}.style is not an object`);
  (n.children as unknown[] | undefined)?.forEach((c, i) => {
    checkNode(c, `${at}.children[${i}]`);
  });
}

export function figmaScreens(doc: unknown): Screen[] {
  const roots: FNode[] = [];
  if (!isObj(doc)) throw new SpecError('a Figma export is a JSON object with "document" or "nodes"');
  if (doc.nodes !== undefined) {
    if (!isObj(doc.nodes)) throw new SpecError('"nodes" is not an object');
    for (const [k, n] of Object.entries(doc.nodes)) {
      if (!isObj(n) || !isObj(n.document)) throw new SpecError(`nodes["${k}"] has no "document"`);
      checkNode(n.document, `nodes["${k}"].document`);
      roots.push(n.document);
    }
  } else if (doc.document !== undefined) {
    checkNode(doc.document, 'document');
    roots.push(doc.document);
  } else throw new SpecError('a Figma export has "document" or "nodes"');
  const frames: FNode[] = [];
  const findFrames = (n: FNode, depth: number) => {
    if (n.visible === false) return;
    if ((n.type === 'FRAME' || n.type === 'COMPONENT') && depth <= 2 && n.absoluteBoundingBox) frames.push(n);
    else for (const c of n.children ?? []) findFrames(c, depth + 1);
  };
  for (const r of roots) findFrames(r, 0);
  return frames.map((f) => {
    const o = f.absoluteBoundingBox as NonNullable<FNode['absoluteBoundingBox']>;
    const elements: DesignElement[] = [];
    const walk = (n: FNode) => {
      if (n.visible === false || (n.opacity ?? 1) === 0) return;
      const b = n.absoluteBoundingBox;
      const box = b ? { x: b.x - o.x, y: b.y - o.y, w: b.width, h: b.height } : undefined;
      if (n.type === 'TEXT' && n.characters?.trim()) {
        const st = n.style ?? {};
        const e: DesignElement = {
          id: n.id,
          kind: 'text',
          text: st.textCase === 'UPPER' ? n.characters.toUpperCase() : n.characters,
          style: {},
        };
        if (box) e.box = box;
        const style = e.style as NonNullable<DesignElement['style']>;
        const col = rgba(n.fills?.[0]);
        if (col) style.color = col;
        if (st.fontSize) style.fontSize = st.fontSize;
        if (st.fontWeight) style.fontWeight = st.fontWeight;
        if (st.fontFamily) style.fontFamily = st.fontFamily;
        if (st.lineHeightPx) style.lineHeight = Math.round(st.lineHeightPx * 100) / 100;
        if (st.letterSpacing !== undefined) style.letterSpacing = st.letterSpacing;
        elements.push(e);
        return;
      }
      if (n !== f && box) {
        const image = (n.fills ?? []).some((x) => x.type === 'IMAGE' && x.visible !== false);
        const bg = rgba(n.fills?.find((x) => x.type === 'SOLID'));
        const border = rgba(n.strokes?.[0]);
        if (image || ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON'].includes(n.type)) {
          elements.push({ id: n.id, kind: 'image', box });
        } else if (bg || (border && (n.strokeWeight ?? 0) > 0)) {
          const style: NonNullable<DesignElement['style']> = {};
          if (bg) style.background = bg;
          if (border && n.strokeWeight) {
            style.borderColor = border;
            style.borderWidth = n.strokeWeight;
          }
          if (n.cornerRadius !== undefined) style.radius = n.cornerRadius;
          const e: DesignElement = {
            id: n.id,
            kind: /button|btn|cta|link|tab|chip|toggle|input/i.test(n.name ?? '') ? 'control' : 'box',
            box,
            style,
          };
          if (e.kind === 'control') e.interactive = true;
          elements.push(e);
        }
      }
      for (const c of n.children ?? []) walk(c);
    };
    walk(f);
    return {
      id: (f.name ?? f.id).replace(/\s+/g, '-').toLowerCase(),
      name: f.name ?? f.id,
      viewport: { width: Math.round(o.width), height: Math.round(o.height) },
      elements,
    };
  });
}

export const figmaAdapter: Adapter = {
  name: 'figma-json',
  version: '0.1.0',
  describes: 'A Figma REST export (GET /v1/files/:key or /v1/files/:key/nodes), frames as screens',
  sniff(input) {
    if (input.isUrl || !/\.json$/i.test(input.path)) return null;
    return /"absoluteBoundingBox"/.test(input.head) && /"type"\s*:\s*"(DOCUMENT|CANVAS|FRAME)"/.test(input.head)
      ? { format: 'figma/rest@1', confidence: 0.9 }
      : null;
  },
  async read(input, ctx) {
    const doc = await readJson(ctx, input.path, 'Figma export');
    const screens = await about(input.path, 'Figma export', () => figmaScreens(doc));
    const warnings = screens.length ? [] : ['no top-level frames found'];
    return spec(provenance('figma-json', 'figma/rest@1', 'structured', 0.85, input.path, warnings), screens);
  },
};

// ── A reference image ────────────────────────────────────────────────────────

export const imageAdapter: Adapter = {
  name: 'image',
  version: '0.1.0',
  describes:
    'A reference image (PNG/JPEG/WebP); with a *.faithful.json sidecar it is placed, without one it is indicative',
  sniff(input) {
    if (input.isUrl) return null;
    return /\.(png|jpe?g|webp)$/i.test(input.path) ? { format: 'image/raster', confidence: 0.5 } : null;
  },
  async read(input, ctx) {
    const sidecar = input.path.replace(/\.(png|jpe?g|webp)$/i, '.faithful.json');
    if (await ctx.exists(sidecar)) {
      const sd = await readJson(ctx, sidecar, 'Faithful spec');
      const s = await about(sidecar, 'Faithful spec', () => validateSpec(sd));
      for (const sc of s.screens) sc.referenceImage ??= input.path;
      return s;
    }
    const screen: Screen = {
      id: screenId(input.path),
      name: screenId(input.path),
      viewport: ctx.viewports[0] ?? { width: 1280, height: 800 },
      elements: [],
      referenceImage: input.path,
    };
    return spec(
      provenance('image', 'image/raster', 'image', 0.2, input.path, [
        'an image has no elements to compare; add a *.faithful.json sidecar (a design agent can write one), or use the HTML the image was made from',
      ]),
      [screen],
    );
  },
};
