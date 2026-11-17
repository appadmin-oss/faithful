/**
 * A Claude Design handoff rendered with no support.js beside it, through Faithful's own runtime:
 * once with its logic (the designer's own values), once with the logic broken (static, where
 * only literal copy may survive and nothing invented is read as design).
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Renderer } from '@faithful/browser';
import { afterAll, describe, expect, it } from 'vitest';
import { dcHtmlAdapter, HOLE } from '../src/index.js';

const handoff = (logic: string) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<x-dc>
  <helmet><style>.t{font:700 32px sans-serif;color:#10292c;margin:24px}</style></helmet>
  <h1 class="t">{{ title }}</h1>
  <sc-if value="{{ showLede }}" hint-placeholder-val="{{ true }}"><p style="margin:0 24px">Cancel any time.</p></sc-if>
  <ul><sc-for list="{{ plans }}" as="p" hint-placeholder-count="3"><li>{{ p.name }}</li></sc-for></ul>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"title":{"default":"Choose your plan"}}'>${logic}</script>
</body></html>`;

let renderer: Renderer | undefined;
afterAll(async () => renderer?.close());

async function read(html: string) {
  const dir = mkdtempSync(join(tmpdir(), 'faithful-dc-'));
  const path = join(dir, 'pricing.dc.html');
  writeFileSync(path, html);
  renderer ??= await Renderer.launch();
  const r = renderer;
  return dcHtmlAdapter.read(
    { path, isUrl: false, head: html },
    {
      viewports: [{ width: 800, height: 600 }],
      render: (t, vp, id) => r.capture(t, vp, id),
      readFile: async (p) => readFileSync(p, 'utf8'),
      exists: async (p) => existsSync(p),
      warn: () => undefined,
    },
  );
}

describe('dc-html', () => {
  it("runs the component: props, renderVals, sc-if and sc-for give the designer's own values", async () => {
    const s = await read(
      handoff(
        'class Component extends DCLogic { renderVals(){ return { title: this.props.title, showLede: true, plans: [{name:"Starter"},{name:"Team"}] }; } }',
      ),
    );
    expect(s.extensions?.['faithful.dc']).toEqual({ mode: 'runtime' });
    const texts = s.screens[0]?.elements.filter((e) => e.kind === 'text').map((e) => e.text);
    expect(texts).toEqual(['Choose your plan', 'Cancel any time.', 'Starter', 'Team']);
    const h1 = s.screens[0]?.elements.find((e) => e.text === 'Choose your plan');
    expect(h1?.style?.fontSize).toBe(32);
  }, 60_000);

  it('logic that throws falls back to static: literal copy kept, every hole dropped, and it says so', async () => {
    const s = await read(handoff('class Component extends DCLogic { renderVals(){ return DATA.missing; } }'));
    expect(s.extensions?.['faithful.dc']).toEqual({ mode: 'static' });
    expect(s.provenance.tier).toBe('static');
    const texts = s.screens[0]?.elements.filter((e) => e.kind === 'text').map((e) => e.text);
    expect(texts).toEqual(['Cancel any time.']);
    expect(texts?.some((t) => t?.includes(HOLE))).toBe(false);
    expect(s.provenance.warnings.join(' ')).toMatch(/data-bound texts left out/);
  }, 60_000);
});
