import { describe, expect, it } from 'vitest';
import {
  copyDeckAdapter,
  designMdAdapter,
  figmaAdapter,
  figmaScreens,
  HOLE,
  inventoryFromTokens,
  scrubHoles,
  tokensAdapter,
  tokensFromCss,
  tokensFromDtcg,
} from '../src/index.js';

const head = (path: string, head: string) => ({ path, isUrl: false, head });
const ctxOf = (files: Record<string, string>) => ({
  viewports: [{ width: 1280, height: 800 }],
  render: () => Promise.reject(new Error('no browser in this test')),
  readFile: async (p: string) => files[p] ?? Promise.reject(new Error(`no ${p}`)),
  exists: async (p: string) => p in files,
  warn: () => undefined,
});

describe('tokens', () => {
  it('DTCG: nested groups, inherited $type, aliases resolved, 2025.10 colour objects', () => {
    const t = tokensFromDtcg({
      color: {
        $type: 'color',
        ink: { $value: '#10292C' },
        text: { $value: '{color.ink}' },
        accent: { $value: { colorSpace: 'srgb', components: [0, 0.5, 0], hex: '#007f00' } },
      },
      font: {
        size: { body: { $type: 'dimension', $value: { value: 16, unit: 'px' } } },
        family: { $value: 'Inter, sans-serif' },
      },
      radius: { card: { $value: '0.75rem' } },
    });
    const by = Object.fromEntries(t.map((x) => [x.name, x]));
    expect(by['color.text']?.value).toBe('#10292C');
    expect(by['color.accent']?.value).toBe('#007f00');
    const inv = inventoryFromTokens(t);
    expect(inv.colors).toEqual(expect.arrayContaining(['#10292c', '#007f00']));
    expect(inv.fontSizes).toContain(16);
    expect(inv.radii).toContain(12);
    expect(inv.fontFamilies).toContain('inter');
  });

  it('CSS custom properties: var() chains and fallbacks resolved, comments ignored', () => {
    const t = tokensFromCss(
      ':root{ --ink:#10292c; /* --dead:#ff0000; */ --text: var(--ink); --edge: var(--missing, #d6d4cc); --fs-body: 16px; --radius-card: 12px }',
    );
    const by = Object.fromEntries(t.map((x) => [x.name, x.value]));
    expect(by.text).toBe('#10292c');
    expect(by.edge).toBe('#d6d4cc');
    expect(by.dead).toBeUndefined();
    expect(inventoryFromTokens(t).fontSizes).toEqual([16]);
  });

  it('sniffs a token sheet and a Tailwind @theme, and not an ordinary stylesheet', () => {
    const vars = Array.from({ length: 6 }, (_, i) => `--c${i}: #00000${i};`).join(' ');
    expect(tokensAdapter.sniff(head('t.css', `:root{ ${vars} }`))?.format).toBe('css/custom-properties');
    expect(tokensAdapter.sniff(head('t.css', `@theme { ${vars} }`))?.format).toBe('tailwind/theme@4');
    expect(tokensAdapter.sniff(head('app.css', '.a{color:red} .b{margin:0} .c{padding:0} .d{} .e{} .f{}'))).toBeNull();
    expect(tokensAdapter.sniff(head('t.tokens.json', '{"ink":{"$value":"#000"}}'))?.format).toBe('dtcg@2025.10');
  });
});

describe('copy deck and DESIGN.md', () => {
  it('a copy deck is every non-blank, non-comment line, deduplicated', async () => {
    const files = { 'copy.txt': '# hero\nChoose your plan\n\nCancel any time.\nChoose your plan\nStart free trial\n' };
    const s = await copyDeckAdapter.read(head('copy.txt', files['copy.txt']), ctxOf(files));
    expect(s.inventory?.texts).toEqual(['Choose your plan', 'Cancel any time.', 'Start free trial']);
  });

  it('DESIGN.md: colours, sizes, radii and faces from prose and tables, not from HTML entities', async () => {
    const md =
      '# Design\n\nInk #10292C, ground #f1efe9, accent #237b22. Not a colour: &#123;\n\n| Role | Font size |\n|---|---|\n| Body | font-size 16px |\n\nCards: radius 14px.\n\nTypeface: Playfair Display (headlines)\n';
    const files = { 'DESIGN.md': md };
    expect(designMdAdapter.sniff(head('DESIGN.md', md))).not.toBeNull();
    const s = await designMdAdapter.read(head('DESIGN.md', md), ctxOf(files));
    expect(s.inventory?.colors).toEqual(expect.arrayContaining(['#10292c', '#f1efe9', '#237b22']));
    expect(s.inventory?.colors).toHaveLength(3);
    expect(s.inventory?.fontSizes).toContain(16);
    expect(s.inventory?.radii).toContain(14);
    expect(s.inventory?.fontFamilies).toContain('playfair display');
  });
});

describe('Figma REST export', () => {
  const doc = {
    document: {
      id: '0:0',
      type: 'DOCUMENT',
      children: [
        {
          id: '0:1',
          type: 'CANVAS',
          children: [
            {
              id: '1:1',
              name: 'Pricing Page',
              type: 'FRAME',
              absoluteBoundingBox: { x: 1000, y: 500, width: 1440, height: 900 },
              children: [
                {
                  id: '1:2',
                  type: 'TEXT',
                  characters: 'choose',
                  absoluteBoundingBox: { x: 1100, y: 600, width: 300, height: 40 },
                  style: { fontFamily: 'Inter', fontSize: 32, fontWeight: 700, lineHeightPx: 40, textCase: 'UPPER' },
                  fills: [{ type: 'SOLID', color: { r: 0.0627, g: 0.1608, b: 0.1725, a: 1 } }],
                },
                {
                  id: '1:3',
                  name: 'Button / primary',
                  type: 'RECTANGLE',
                  absoluteBoundingBox: { x: 1100, y: 700, width: 160, height: 48 },
                  cornerRadius: 999,
                  fills: [{ type: 'SOLID', color: { r: 0.137, g: 0.482, b: 0.133, a: 1 } }],
                },
                {
                  id: '1:4',
                  type: 'RECTANGLE',
                  visible: false,
                  absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
                  fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }],
                },
                {
                  id: '1:5',
                  type: 'RECTANGLE',
                  absoluteBoundingBox: { x: 1500, y: 600, width: 400, height: 300 },
                  fills: [{ type: 'IMAGE' }],
                },
              ],
            },
          ],
        },
      ],
    },
  };

  it('frames become screens with frame-relative boxes; hidden layers are skipped; UPPER text case applied', () => {
    const [s] = figmaScreens(doc);
    expect(s?.id).toBe('pricing-page');
    expect(s?.viewport).toEqual({ width: 1440, height: 900 });
    const t = s?.elements.find((e) => e.id === '1:2');
    expect(t?.text).toBe('CHOOSE');
    expect(t?.box).toEqual({ x: 100, y: 100, w: 300, h: 40 });
    expect(t?.style?.fontSize).toBe(32);
    const btn = s?.elements.find((e) => e.id === '1:3');
    expect(btn?.kind).toBe('control');
    expect(btn?.style?.radius).toBe(999);
    expect(s?.elements.find((e) => e.id === '1:4')).toBeUndefined();
    expect(s?.elements.find((e) => e.id === '1:5')?.kind).toBe('image');
  });

  it('sniffs a Figma export and not any JSON with boxes', () => {
    expect(figmaAdapter.sniff(head('f.json', JSON.stringify(doc)))).not.toBeNull();
    expect(figmaAdapter.sniff(head('f.json', '{"absoluteBoundingBox":{}}'))).toBeNull();
  });
});

describe('malformed design files', () => {
  const read = (adapter: typeof figmaAdapter, path: string, text: string) =>
    adapter.read(head(path, text), ctxOf({ [path]: text }) as never);
  const frame = (child: unknown) =>
    JSON.stringify({
      document: {
        type: 'DOCUMENT',
        id: '0',
        children: [
          { type: 'FRAME', id: '1', absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 }, children: child },
        ],
      },
    });

  it('a Figma export of the wrong shape is named, file and place, not a TypeError', async () => {
    for (const [text, where] of [
      ['{"nodes":{"1:2":null}}', /f\.json: not a valid Figma export: nodes\["1:2"\] has no "document"/],
      [frame({}), /f\.json: .*document\.children\[0\]\.children is not a list/],
      [frame([{ type: 'TEXT', id: '2', characters: 5 }]), /f\.json: .*children\[0\]\.characters is not text/],
      ['{"document":', /f\.json: not valid JSON/],
    ] as const) {
      const err = await read(figmaAdapter, 'f.json', text).catch((e: Error) => e);
      expect(err, text).toBeInstanceOf(Error);
      expect((err as Error).name).toBe('SpecError');
      expect((err as Error).message).toMatch(where);
    }
    // A well-formed one still reads.
    const ok = await read(
      figmaAdapter,
      'f.json',
      frame([{ type: 'TEXT', id: '2', characters: 'Hi', absoluteBoundingBox: { x: 1, y: 1, width: 5, height: 5 } }]),
    );
    expect(ok.screens[0]?.elements.map((e) => e.text)).toEqual(['Hi']);
  });

  it('a DTCG file of the wrong shape is named too', async () => {
    for (const [text, where] of [
      ['{"color":{"$value":"#fff", ', /t\.tokens\.json: not valid JSON/],
      ['{"a":{"$value":{"hex":5}}}', /t\.tokens\.json: .*token "a": a colour's "hex" must be a string/],
    ] as const) {
      const err = await read(tokensAdapter, 't.tokens.json', text).catch((e: Error) => e);
      expect((err as Error).name, text).toBe('SpecError');
      expect((err as Error).message).toMatch(where);
    }
  });
});

describe('data holes', () => {
  it('a text that was a hole is not design copy; a control keeps its box and loses its words', () => {
    const { screen, dropped } = scrubHoles({
      id: 's',
      name: 's',
      viewport: { width: 800, height: 600 },
      elements: [
        { id: 'a', kind: 'text', text: 'Choose your plan', box: { x: 0, y: 0, w: 100, h: 20 } },
        { id: 'b', kind: 'text', text: `${HOLE} students`, box: { x: 0, y: 30, w: 100, h: 20 } },
        { id: 'c', kind: 'control', text: HOLE, box: { x: 0, y: 60, w: 100, h: 44 } },
      ],
    });
    expect(dropped).toBe(2);
    expect(screen.elements.map((e) => e.id)).toEqual(['a', 'c']);
    expect(screen.elements[1]?.text).toBeUndefined();
  });
});
