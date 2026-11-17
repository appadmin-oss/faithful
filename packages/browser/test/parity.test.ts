/**
 * Parity on real pages: a complete re-skin of fixtures/parity/before.html passes (only an honest
 * rename to confirm); the same re-skin with four planted losses fails on each of them.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compareParity } from '@faithful/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Renderer } from '../src/index.js';

const FIX = resolve(__dirname, '../../../fixtures/parity');
let r: Renderer;
beforeAll(async () => {
  r = await Renderer.launch();
}, 60_000);
afterAll(async () => r?.close());
const facts = (f: string) =>
  r.audit({ html: readFileSync(resolve(FIX, f), 'utf8'), baseDir: FIX }, { width: 1280, height: 800 });

describe('parity on rendered pages', () => {
  it('a full re-skin with the same functions passes; the one rename is flagged for confirmation', async () => {
    const res = compareParity(await facts('before.html'), await facts('after-good.html'), 'p');
    expect(res.findings.filter((f) => f.severity !== 'info').map((f) => `${f.kind}: ${f.detail}`)).toEqual([
      'renamed: link "My orders" is now "Your orders": confirm it is the same action',
    ]);
  }, 60_000);

  it('every planted loss is caught', async () => {
    const res = compareParity(await facts('before.html'), await facts('after-bad.html'), 'p');
    const d = res.findings.map((f) => f.detail).join('\n');
    expect(d).toMatch(/link "Delete account" → \/account\/delete is gone/);
    expect(d).toMatch(/field "email" \(Email\) is gone from the form; is it "emailAddress"\?/);
    expect(d).toMatch(/now sends to \/subscribe, not \/newsletter/);
    expect(d).toMatch(/contentinfo landmark is gone/);
  }, 60_000);
});
