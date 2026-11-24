/**
 * A Claude Design design system: `project/design-system.json` and the `tokens.json` beside it.
 * The DTCG reader cannot read these (no `$value`): tokens are LISTS of `{name, value, usage}`,
 * grouped by what they are, and a value may differ per theme.
 *
 * The shape accepted, tolerantly, since the format is not published:
 *
 *   tokens.json    a list of tokens; or `{ "tokens": … }`; or groups of lists, nested up to
 *                  four deep (`{ "color": [ … ], "type": { "size": [ … ] } }`). Any list whose
 *                  items carry a string `name` and a value is a token list; other lists are
 *                  left alone.
 *   a token        `{ "name": "bg", "value": V, "usage": "Page background" }`; `values` is read
 *                  as `value`; a token with no `value` but theme keys (`"light": …, "dark": …`)
 *                  is read as per-theme. `type` or `category`, when present, is a hint.
 *   V              a string or number (`"#fff"`, `"16px"`, `1.5`, `"Inter, sans-serif"`); or a
 *                  per-theme object (`{ "light": "#fff", "dark": "#000" }`), EVERY theme's value
 *                  going into the inventory; or a type style (`{ "fontSize": "16px",
 *                  "fontFamily": "Inter", "lineHeight": 1.5, … }`).
 *   design-system.json  read the same way, plus the `tokens.json` beside it (or the `.json`
 *                  file its `"tokens"` names).
 *
 * What a token is comes from its group, its name, its hint and its value: a colour value is a
 * colour; a dimension in a radius group (or named so) is a radius; one in a type group is a
 * font size; spacing, shadows and breakpoints are kept as tokens but are not in the inventory.
 */
import { basename, dirname, join } from 'node:path';
import type { Adapter, ReadContext } from '@usefaithful/core';
import { parseColor, toHex } from '@usefaithful/core';
import type { Inventory, Token } from '@usefaithful/spec';
import { emptyInventory, SpecError } from '@usefaithful/spec';
import { px } from './formats.js';
import { mergeInventory, provenance, spec } from './util.js';

export const DESIGN_SYSTEM_FORMAT = 'claude-design/design-system@1';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const scalar = (v: unknown): v is string | number =>
  typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
const STYLE_KEYS = ['fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'letterSpacing'];
const THEME_KEYS = /^(light|dark|default|base|high-?contrast|dim|night|day)$/i;

const tokenish = (v: unknown): boolean =>
  isObj(v) &&
  typeof v.name === 'string' &&
  ('value' in v || 'values' in v || Object.keys(v).some((k) => THEME_KEYS.test(k)));

/** A value as `[suffix, scalar]` pairs: one for a plain value, one per theme or per style key. */
function expand(v: unknown, at: string): Array<[string, string | number, string | undefined]> {
  if (scalar(v)) return [['', v, undefined]];
  if (isObj(v)) {
    const keys = Object.keys(v);
    if (!keys.length) throw new SpecError(`${at} is an empty object`);
    const style = keys.some((k) => STYLE_KEYS.includes(k));
    const out: Array<[string, string | number, string | undefined]> = [];
    for (const k of keys) {
      const x = v[k];
      if (style) {
        if (x === undefined || x === null) continue;
        if (!scalar(x)) throw new SpecError(`${at}.${k} must be a string or a number`);
        out.push([`.${k}`, x, k]);
      } else {
        // A per-theme value; a theme may itself be a type style.
        for (const [s, y, hint] of expand(x, `${at}.${k}`)) out.push([`@${k}${s}`, y, hint]);
      }
    }
    return out;
  }
  throw new SpecError(`${at} must be a string, a number, or an object of theme → value`);
}

type Kind = 'color' | 'fontFamily' | 'fontSize' | 'radius' | 'fontWeight' | 'other';

function kindOf(hint: string, value: string | number): Kind {
  const h = hint.toLowerCase();
  if (typeof value === 'string' && parseColor(value)) return 'color';
  if (/famil|typeface|font-?face|(^|[\s.])fonts?($|[\s.])/.test(h) && typeof value === 'string' && !px(value))
    return 'fontFamily';
  if (/weight/.test(h)) return 'fontWeight';
  if (px(value) === null) return 'other';
  if (/radi(us|i)|rounded|corner/.test(h)) return 'radius';
  if (
    /spac|gap|padding|margin|shadow|breakpoint|width|height|line-?height|letter|tracking|leading|z-?index|duration/.test(
      h,
    )
  )
    return 'other';
  if (/font-?size|type|typo|text|heading|display|body|caption|label|title/.test(h)) return 'fontSize';
  return 'other';
}

/** Tokens and an inventory from one parsed file. `at` names the file, for errors. */
export function designSystemTokens(doc: unknown): { tokens: Token[]; inventory: Inventory } {
  const tokens: Token[] = [];
  const inv = emptyInventory();
  const list = (items: unknown[], group: string[], place: string) => {
    items.forEach((item, i) => {
      const at = `${place}[${i}]`;
      if (!isObj(item)) throw new SpecError(`${at} is not a token ({ name, value, usage })`);
      if (typeof item.name !== 'string' || !item.name.trim()) throw new SpecError(`${at}.name is not text`);
      const raw =
        'value' in item
          ? item.value
          : 'values' in item
            ? item.values
            : Object.fromEntries(Object.entries(item).filter(([k]) => THEME_KEYS.test(k)));
      const declared = [item.type, item.category].filter((x) => typeof x === 'string').join(' ');
      for (const [suffix, value, styleKey] of expand(
        raw,
        `${at}.${'value' in item ? 'value' : 'values' in item ? 'values' : '(themes)'}`,
      )) {
        const name = [...group, item.name].join('.') + suffix;
        const kind = kindOf(`${group.join(' ')} ${item.name} ${declared} ${styleKey ?? ''}`, value);
        if (kind === 'color') {
          const c = parseColor(String(value));
          if (c && c.a > 0) inv.colors.push(toHex(c));
          tokens.push({ name, type: 'color', value });
        } else if (kind === 'fontFamily') {
          const face = String(value)
            .split(',')[0]
            ?.trim()
            .replace(/^['"]|['"]$/g, '')
            .toLowerCase();
          if (face) inv.fontFamilies.push(face);
          tokens.push({ name, type: 'fontFamily', value });
        } else if (kind === 'fontSize' || kind === 'radius') {
          const n = px(value) as number;
          (kind === 'fontSize' ? inv.fontSizes : inv.radii).push(n);
          tokens.push({ name, type: 'dimension', value });
        } else if (kind === 'fontWeight') tokens.push({ name, type: 'fontWeight', value });
        else tokens.push({ name, type: typeof value === 'number' ? 'number' : 'other', value });
      }
    });
  };
  const walk = (node: unknown, group: string[], place: string, depth: number) => {
    if (depth > 4) return;
    if (Array.isArray(node)) {
      if (node.some(tokenish)) list(node, group, place);
      return;
    }
    if (!isObj(node)) return;
    for (const [k, v] of Object.entries(node)) {
      // `tokens` is a container, not a group name.
      walk(v, k === 'tokens' ? group : [...group, k], place ? `${place}.${k}` : k, depth + 1);
    }
  };
  walk(doc, [], '', 0);
  return { tokens, inventory: mergeInventory(emptyInventory(), inv) };
}

async function parse(ctx: ReadContext, path: string): Promise<unknown> {
  const text = await ctx.readFile(path);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new SpecError(`${path}: not valid JSON, so not a design system (${(e as Error).message})`);
  }
}

function read(path: string, doc: unknown): { tokens: Token[]; inventory: Inventory } {
  try {
    return designSystemTokens(doc);
  } catch (e) {
    throw new SpecError(`${path}: not a valid design-system token file: ${(e as Error).message}`);
  }
}

export const designSystemAdapter: Adapter = {
  name: 'design-system',
  version: '0.1.0',
  describes:
    'Claude Design design systems (design-system.json + tokens.json: {name, value, usage} lists, per-theme values)',
  sniff(input) {
    if (input.isUrl || !/\.json$/i.test(input.path) || /"\$value"\s*:/.test(input.head)) return null;
    if (/(^|[\\/])design-system\.json$/i.test(input.path)) return { format: DESIGN_SYSTEM_FORMAT, confidence: 0.9 };
    const listed = /"name"\s*:/.test(input.head) && /"(value|values|light|dark)"\s*:/.test(input.head);
    if (!listed) return null;
    if (/"usage"\s*:/.test(input.head)) return { format: DESIGN_SYSTEM_FORMAT, confidence: 0.85 };
    return /(^|[\\/])tokens\.json$/i.test(input.path) ? { format: DESIGN_SYSTEM_FORMAT, confidence: 0.7 } : null;
  },
  async read(input, ctx) {
    const doc = await parse(ctx, input.path);
    const parts = [read(input.path, doc)];
    const sources = [basename(input.path)];
    if (/(^|[\\/])design-system\.json$/i.test(input.path)) {
      const named =
        isObj(doc) && typeof doc.tokens === 'string' && /\.json$/i.test(doc.tokens) ? doc.tokens : undefined;
      const beside = join(dirname(input.path), named ?? 'tokens.json');
      if (await ctx.exists(beside)) {
        parts.push(read(beside, await parse(ctx, beside)));
        sources.push(basename(beside));
      } else if (named) throw new SpecError(`${input.path}: "tokens" names ${named}, which is not beside it`);
    }
    const tokens = parts.flatMap((p) => p.tokens);
    const inventory = parts.reduce((a, p) => mergeInventory(a, p.inventory), emptyInventory());
    const warnings = tokens.length ? [] : [`no {name, value} tokens found in ${sources.join(' or ')}`];
    return spec(provenance('design-system', DESIGN_SYSTEM_FORMAT, 'static', 0.6, input.path, warnings), [], {
      tokens,
      inventory,
    });
  },
};
