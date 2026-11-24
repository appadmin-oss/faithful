/**
 * Claude Design inside Claude: a design artifact is `project/canvas.json` over ordinary
 * `.dc.html` boards.
 *
 *   { "v": 3,
 *     "boards": { "home.dc.html": { "x": 0, "y": 0, "w": 1440, "h": 900, "title": "Home",
 *                                   "expand": "fill", "is_interactive": true }, … } }
 *
 * Each board is one screen, rendered by the reader that already understands it (dc-html, or
 * html for a plain page) at the board's OWN width: a 390-wide board is a phone screen, not
 * the desktop page squeezed. `expand: "fill"` means the board fills its frame, so its height
 * is a viewport's (900, or 844 under 600px, as `--viewports 390` gives); otherwise it is `h`.
 * `x`, `y` and `is_interactive` place the board on the canvas and are not read.
 *
 * A board named in the canvas but not on disk is a reader warning, never a crash: the rest of
 * the canvas is still a design. A canvas version other than 3 is refused by name, so a future
 * format is never misread as this one.
 */
import { dirname, join } from 'node:path';
import type { Adapter, ReadContext, SourceInput } from '@usefaithful/core';
import type { Screen, Tier } from '@usefaithful/spec';
import { SpecError } from '@usefaithful/spec';
import { dcHtmlAdapter } from './dc-html.js';
import { htmlAdapter } from './html.js';
import { provenance, screenId, spec } from './util.js';

export const CANVAS_FORMAT = 'claude-design/canvas@3';

export interface CanvasBoard {
  /** The board file, as the canvas names it (relative to the canvas). */
  file: string;
  /** Screen id: the file name without `.dc.html`. */
  id: string;
  title: string;
  width: number;
  height: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** The boards of a canvas, checked. Every fault names its place; the caller adds the file. */
export function canvasBoards(doc: unknown): CanvasBoard[] {
  if (!isObj(doc)) throw new SpecError('a canvas is a JSON object with "v" and "boards"');
  if (doc.v === undefined) throw new SpecError('no "v" (canvas version)');
  if (doc.v !== 3)
    throw new SpecError(`canvas version ${JSON.stringify(doc.v)} is not one Faithful reads (it reads "v": 3)`);
  if (!isObj(doc.boards)) throw new SpecError('"boards" is not an object of file → board');
  const out: CanvasBoard[] = [];
  for (const [file, b] of Object.entries(doc.boards)) {
    const at = `boards[${JSON.stringify(file)}]`;
    if (!isObj(b)) throw new SpecError(`${at} is not an object`);
    if (!positive(b.w)) throw new SpecError(`${at}.w must be a positive number`);
    if (b.title !== undefined && typeof b.title !== 'string') throw new SpecError(`${at}.title is not text`);
    if (b.expand !== undefined && typeof b.expand !== 'string') throw new SpecError(`${at}.expand is not text`);
    const fill = b.expand === 'fill';
    if (!fill && !positive(b.h)) throw new SpecError(`${at}.h must be a positive number (or "expand": "fill")`);
    const width = Math.round(b.w);
    out.push({
      file,
      id: screenId(file),
      title: (b.title as string | undefined)?.trim() || screenId(file),
      width,
      height: fill ? (width < 600 ? 844 : 900) : Math.round(b.h as number),
    });
  }
  // Two boards with one name in different folders keep their folder, so --screen can tell them apart.
  const seen = new Map<string, number>();
  for (const b of out) seen.set(b.id, (seen.get(b.id) ?? 0) + 1);
  for (const b of out)
    if ((seen.get(b.id) ?? 0) > 1) b.id = b.file.replace(/\.(dc\.html|html?)$/i, '').replace(/[\\/]+/g, '/');
  return out;
}

/** Where a board file is: beside the canvas, or (for `project/canvas.json`) beside `project/`. */
async function locate(canvasPath: string, file: string, exists: ReadContext['exists']): Promise<string | undefined> {
  const dir = dirname(canvasPath);
  const dirs = [dir];
  if (/(^|[\\/])project$/.test(dir)) dirs.push(dirname(dir));
  for (const d of dirs) {
    const p = join(d, file);
    if (await exists(p)) return p;
  }
  return undefined;
}

const RANK: Record<Tier, number> = { structured: 4, vector: 3, rendered: 2, static: 1, image: 0 };

export const canvasAdapter: Adapter = {
  name: 'claude-canvas',
  version: '0.1.0',
  describes:
    'Claude Design canvases (project/canvas.json, "v": 3): each .dc.html board one screen at its own size (pick one with --screen)',
  sniff(input) {
    if (input.isUrl || !/\.json$/i.test(input.path)) return null;
    const named = /(^|[\\/])canvas\.json$/i.test(input.path);
    const shaped = /"boards"\s*:\s*\{/.test(input.head) && /"v"\s*:/.test(input.head);
    if (named && shaped) return { format: CANVAS_FORMAT, confidence: 0.95 };
    if (shaped) return { format: CANVAS_FORMAT, confidence: 0.85 };
    if (named && !/"\$value"\s*:/.test(input.head)) return { format: CANVAS_FORMAT, confidence: 0.7 };
    return null;
  },
  async read(input, ctx) {
    const text = await ctx.readFile(input.path);
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      throw new SpecError(`${input.path}: not valid JSON, so not a canvas (${(e as Error).message})`);
    }
    let boards: CanvasBoard[];
    try {
      boards = canvasBoards(doc);
    } catch (e) {
      throw new SpecError(`${input.path}: not a valid Claude Design canvas: ${(e as Error).message}`);
    }
    const warnings: string[] = [];
    const screens: Screen[] = [];
    let tier: Tier = 'rendered';
    let confidence = 0.9;
    for (const b of boards) {
      const path = await locate(input.path, b.file, ctx.exists);
      if (!path) {
        warnings.push(`board ${b.file} ("${b.title}") is not on disk beside the canvas; left out`);
        continue;
      }
      const html = await ctx.readFile(path);
      const src: SourceInput = { path, isUrl: false, head: html.slice(0, 65536) };
      const reader = dcHtmlAdapter.sniff(src) ? dcHtmlAdapter : htmlAdapter;
      const s = await reader.read(src, { ...ctx, viewports: [{ width: b.width, height: b.height }] });
      for (const w of s.provenance.warnings) warnings.push(`${b.file}: ${w}`);
      if (RANK[s.provenance.tier] < RANK[tier]) tier = s.provenance.tier;
      confidence = Math.min(confidence, s.provenance.confidence);
      for (const sc of s.screens) screens.push({ ...sc, id: b.id, name: b.title });
    }
    if (!boards.length) warnings.push('the canvas has no boards');
    return spec(provenance('claude-canvas', CANVAS_FORMAT, tier, confidence, input.path, warnings), screens);
  },
};
