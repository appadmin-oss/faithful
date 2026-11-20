/**
 * Claude Design inside Claude: a canvas (`project/canvas.json`, "v": 3) of `.dc.html` boards,
 * and a design system (`design-system.json` + `tokens.json`) of {name, value, usage} lists.
 * The fixtures in `fixtures/canvas/` are synthetic.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Renderer } from '@faithful/browser';
import { pickAdapter } from '@faithful/core';
import { afterAll, describe, expect, it } from 'vitest';
import { ADAPTERS, canvasAdapter, canvasBoards, designSystemAdapter, designSystemTokens } from '../src/index.js';

const FIX = resolve(__dirname, '../../../fixtures/canvas/project');
const head = (path: string, head: string) => ({ path, isUrl: false, head });

let renderer: Renderer | undefined;
afterAll(async () => renderer?.close());

const ctx = async () => {
  renderer ??= await Renderer.launch();
  const r = renderer;
  return {
    viewports: [{ width: 1440, height: 900 }],
    render: (t: Parameters<Renderer['capture']>[0], vp: { width: number; height: number }, id: string) =>
      r.capture(t, vp, id),
    readFile: async (p: string) => readFileSync(p, 'utf8'),
    exists: async (p: string) => existsSync(p),
    warn: () => undefined,
  };
};
const readCanvas = async (path: string) =>
  canvasAdapter.read(head(path, readFileSync(path, 'utf8')), (await ctx()) as never);
const noBrowser = (files: Record<string, string>) => ({
  viewports: [{ width: 1280, height: 800 }],
  render: () => Promise.reject(new Error('no browser in this test')),
  readFile: async (p: string) => files[p] ?? Promise.reject(new Error(`no ${p}`)),
  exists: async (p: string) => p in files,
  warn: () => undefined,
});

describe('canvas boards', () => {
  it('each board at its own width; "fill" is 900 high, 844 under 600px; otherwise its own h', () => {
    const b = canvasBoards({
      v: 3,
      boards: {
        'home.dc.html': { x: 0, y: 0, w: 1440, h: 3000, title: 'Home', expand: 'fill', is_interactive: true },
        'phone.dc.html': { x: 0, y: 0, w: 390, h: 2000, expand: 'fill' },
        'card.dc.html': { x: 0, y: 0, w: 320, h: 240, title: '  ' },
      },
    });
    expect(b.map((x) => [x.id, x.title, x.width, x.height])).toEqual([
      ['home', 'Home', 1440, 900],
      ['phone', 'phone', 390, 844],
      ['card', 'card', 320, 240],
    ]);
  });

  it('two boards of one name in different folders keep their folder as the id', () => {
    const b = canvasBoards({
      v: 3,
      boards: { 'a/home.dc.html': { w: 800, h: 600 }, 'b/home.dc.html': { w: 800, h: 600 } },
    });
    expect(b.map((x) => x.id)).toEqual(['a/home', 'b/home']);
  });

  it('an unknown version or a malformed board is named, file and place, not a TypeError', async () => {
    for (const [text, where] of [
      ['{"v":4,"boards":{}}', /c\/canvas\.json: .*canvas version 4 is not one Faithful reads/],
      ['{"boards":{}}', /c\/canvas\.json: .*no "v"/],
      ['{"v":3,"boards":[]}', /c\/canvas\.json: .*"boards" is not an object/],
      [
        '{"v":3,"boards":{"a.dc.html":{"w":"wide","h":10}}}',
        /c\/canvas\.json: .*boards\["a\.dc\.html"\]\.w must be a positive number/,
      ],
      ['{"v":3,"boards":{"a.dc.html":{"w":10}}}', /c\/canvas\.json: .*boards\["a\.dc\.html"\]\.h must be/],
      ['{"v":3,"boards":{"a.dc.html":{"w":10,"h":10,"title":5}}}', /boards\["a\.dc\.html"\]\.title is not text/],
      ['{"v":3,', /c\/canvas\.json: not valid JSON/],
    ] as const) {
      const err = await canvasAdapter
        .read(head('c/canvas.json', text), noBrowser({ 'c/canvas.json': text }) as never)
        .catch((e: Error) => e);
      expect((err as Error).name, text).toBe('SpecError');
      expect((err as Error).message).toMatch(where);
    }
  });
});

describe('canvas reader', () => {
  it('reads every board through the dc-html reader: one screen each, at its size, titled', async () => {
    const s = await readCanvas(join(FIX, 'canvas.json'));
    expect(s.provenance.format).toBe('claude-design/canvas@3');
    expect(s.provenance.warnings).toEqual([]);
    expect(s.screens.map((x) => [x.id, x.name, x.viewport.width, x.viewport.height])).toEqual([
      ['home', 'Home', 1280, 900],
      ['pricing', 'Pricing (mobile)', 390, 700],
    ]);
    const texts = (i: number) => s.screens[i]?.elements.filter((e) => e.kind === 'text').map((e) => e.text);
    // The component's own logic ran: the title prop and the plans list are the designer's values.
    expect(texts(0)).toContain('Work together, calmly.');
    expect(texts(1)).toEqual(['Pricing', 'Starter', 'Team']);
    // At the board's width, not the context's 1440.
    expect(s.screens[1]?.elements.find((e) => e.text === 'Starter')?.box?.w).toBeLessThan(390);
  }, 90_000);

  it('a board not on disk is a reader warning; the rest of the canvas is still read', async () => {
    const d = mkdtempSync(join(tmpdir(), 'faithful-canvas-'));
    // Boards beside project/ rather than in it are found too.
    mkdirSync(join(d, 'project'));
    copyFileSync(join(FIX, 'home.dc.html'), join(d, 'home.dc.html'));
    const canvas = join(d, 'project', 'canvas.json');
    writeFileSync(
      canvas,
      JSON.stringify({
        v: 3,
        boards: {
          'home.dc.html': { x: 0, y: 0, w: 1280, h: 10, title: 'Home', expand: 'fill' },
          'gone.dc.html': { x: 0, y: 0, w: 390, h: 800, title: 'Gone' },
        },
      }),
    );
    const s = await readCanvas(canvas);
    expect(s.screens.map((x) => x.id)).toEqual(['home']);
    expect(s.provenance.warnings).toEqual(['board gone.dc.html ("Gone") is not on disk beside the canvas; left out']);
  }, 90_000);
});

describe('design-system tokens', () => {
  it('{name, value, usage} lists: every theme of a colour, type sizes, faces, radii; spacing kept out', async () => {
    const path = join(FIX, 'design-system.json');
    const s = await designSystemAdapter.read(head(path, readFileSync(path, 'utf8')), noBrowserFs() as never);
    expect(s.provenance.format).toBe('claude-design/design-system@1');
    expect(s.screens).toEqual([]);
    const inv = s.inventory;
    expect(inv?.colors.sort()).toEqual(
      ['#f6f4ee', '#101614', '#16302b', '#eef2f0', '#4d5a57', '#a9b5b1', '#1f6f50', '#ffffff'].sort(),
    );
    expect(inv?.fontSizes).toEqual([16, 40]);
    expect(inv?.fontFamilies).toEqual(['sans-serif']);
    expect(inv?.radii).toEqual([8, 12]);
    expect(s.tokens?.find((t) => t.name === 'color.ground@dark')).toEqual({
      name: 'color.ground@dark',
      type: 'color',
      value: '#101614',
    });
    expect(s.tokens?.find((t) => t.name === 'spacing.page')?.type).toBe('other');
  });

  it('tolerates a bare list, a "tokens" container, `values`, and theme keys on the token itself', () => {
    const { inventory } = designSystemTokens({
      tokens: {
        colors: [
          { name: 'bg', values: { light: '#ffffff', dark: '#000000' } },
          { name: 'line', light: '#dddddd', dark: '#333333', usage: 'Dividers' },
        ],
        components: ['Button', 'Card'],
      },
      'font-size': [{ name: 'sm', value: '0.875rem' }],
      corner: [{ name: 'pill', value: 999 }],
      fonts: [{ name: 'brand', value: "'Inter Display', system-ui, sans-serif" }],
      // Spacing around text is not a type size.
      spacing: [{ name: 'text-gap', value: '40px' }],
    });
    expect(inventory.colors).toEqual(['#ffffff', '#000000', '#dddddd', '#333333']);
    expect(inventory.fontSizes).toEqual([14]);
    expect(inventory.radii).toEqual([999]);
    expect(inventory.fontFamilies).toEqual(['inter display']);
  });

  it('a malformed token is named, file and place', async () => {
    for (const [text, where] of [
      [
        '{"color":[{"name":"a","value":"#fff"},{"name":"b","value":true}]}',
        /t\/tokens\.json: .*color\[1\]\.value must be/,
      ],
      ['{"color":[{"name":"a","value":"#fff"},7]}', /color\[1\] is not a token/],
      ['{"type":[{"name":"h1","value":{"fontSize":[40]}}]}', /type\[0\]\.value\.fontSize must be a string or a number/],
      ['{"color":[', /t\/tokens\.json: not valid JSON/],
    ] as const) {
      const err = await designSystemAdapter
        .read(head('t/tokens.json', text), noBrowser({ 't/tokens.json': text }) as never)
        .catch((e: Error) => e);
      expect((err as Error).name, text).toBe('SpecError');
      expect((err as Error).message).toMatch(where);
    }
  });
});

function noBrowserFs() {
  return {
    viewports: [{ width: 1280, height: 800 }],
    render: () => Promise.reject(new Error('no browser in this test')),
    readFile: async (p: string) => readFileSync(p, 'utf8'),
    exists: async (p: string) => existsSync(p),
    warn: () => undefined,
  };
}

describe('sniffing: each Claude Design file goes to its own reader', () => {
  const who = (path: string, text: string) => pickAdapter(ADAPTERS, head(path, text))?.adapter.name;
  it('canvas, design system, DTCG and Figma are told apart', () => {
    const fix = (f: string) => readFileSync(join(FIX, f), 'utf8');
    expect(who('project/canvas.json', fix('canvas.json'))).toBe('claude-canvas');
    expect(who('design.json', fix('canvas.json'))).toBe('claude-canvas');
    // A canvas.json too broken to be shaped still goes to the reader that names its fault.
    expect(who('project/canvas.json', '{"v": 4}')).toBe('claude-canvas');
    expect(who('project/tokens.json', fix('tokens.json'))).toBe('design-system');
    expect(who('project/design-system.json', fix('design-system.json'))).toBe('design-system');
    expect(who('brand.json', '[{"name":"ink","value":"#111","usage":"Text"}]')).toBe('design-system');
    // A DTCG file stays DTCG, whatever it is called, and a canvas is never read as tokens.
    const dtcg = '{"color":{"ink":{"$value":"#111","$type":"color","name":"x","usage":"y"}}}';
    expect(who('tokens.json', dtcg)).toBe('tokens');
    expect(who('canvas.json', dtcg)).toBe('tokens');
    expect(who('design-system.json', dtcg)).toBe('tokens');
    expect(who('x.tokens.json', fix('tokens.json'))).toBe('design-system');
    // A Figma export with names and values is still Figma.
    expect(
      who(
        'f.json',
        '{"name":"F","document":{"type":"DOCUMENT","children":[{"type":"FRAME","name":"a","absoluteBoundingBox":{},"value":1}]}}',
      ),
    ).toBe('figma-json');
    // An ordinary JSON file with names is nobody's design.
    expect(who('package.json', '{"name":"x","version":"1.0.0"}')).toBeUndefined();
  });
});
