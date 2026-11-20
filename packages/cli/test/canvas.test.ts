/**
 * A Claude Design canvas through the CLI: one build is one board, so a canvas of several
 * boards needs `--screen`, and a single design at several viewports still needs nothing.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickScreens } from '../src/api.js';

const BIN = resolve(__dirname, '../dist/bin.js');
const FIX = resolve(__dirname, '../../../fixtures/canvas');
const run = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 90_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const copy = () => {
  const d = mkdtempSync(join(tmpdir(), 'faithful-canvas-cli-'));
  cpSync(FIX, d, { recursive: true });
  return d;
};
const screensOf = (d: string) =>
  JSON.parse(readFileSync(join(d, '.faithful/last.json'), 'utf8')).screens.map((s: { screen: string }) => s.screen);

describe('pickScreens', () => {
  const s = (...ids: string[]) => ids.map((id) => ({ id }));
  it('one board at several viewports is one page: every viewport, no --screen needed', () => {
    expect(pickScreens(s('design@1440', 'design@390'), undefined, 'd.html')).toHaveLength(2);
    expect(pickScreens(s('design@1440', 'design@390'), 'design', 'd.html')).toHaveLength(2);
    expect(pickScreens(s('design@1440', 'design@390'), 'design@390', 'd.html')).toEqual([{ id: 'design@390' }]);
  });
  it('several boards and no --screen, or an unknown one, is a bad call naming the ids', () => {
    expect(() => pickScreens(s('home', 'pricing'), undefined, 'c.json')).toThrow(/--screen <id>: home, pricing/);
    expect(() => pickScreens(s('home', 'pricing'), 'about', 'c.json')).toThrow(
      /no such screen\. Screens: home, pricing/,
    );
    expect(pickScreens(s('home', 'pricing'), 'pricing', 'c.json')).toEqual([{ id: 'pricing' }]);
    // A Figma file of Desktop and Mobile frames is not a canvas of pages: every frame is
    // compared, as before, unless --screen narrows it.
    expect(pickScreens(s('Desktop', 'Mobile'), undefined, 'f.json', false)).toHaveLength(2);
    expect(pickScreens(s('Desktop', 'Mobile'), 'Mobile', 'f.json', false)).toEqual([{ id: 'Mobile' }]);
  });
});

describe('faithful verify on a canvas (bin)', () => {
  it('several boards: exit 2 listing the ids; --screen picks one, PASS when faithful, FAIL when not', () => {
    const d = copy();
    const none = run(d, 'verify', 'project/canvas.json', '--build', 'build-home.html');
    expect(none.code).toBe(2);
    expect(none.err).toMatch(/project\/canvas\.json has 2 screens.*--screen <id>: home, pricing/);
    const ok = run(d, 'verify', 'project/canvas.json', '--build', 'build-home.html', '--screen', 'home');
    expect(ok.out).toMatch(/^faithful PASS clean · 100% match · placed · claude-design\/canvas@3/);
    expect(ok.code).toBe(0);
    expect(screensOf(d)).toEqual(['home']);
    const bad = run(d, 'verify', 'project/canvas.json', '--build', 'build-home-faulty.html', '--screen', 'home');
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('"Work together, calmly." → "Work together, fast."');
    expect(bad.out).toMatch(/background "Get started"/);
    expect(run(d, 'verify', 'project/canvas.json', '--build', 'build-home.html', '--screen', 'nope').code).toBe(2);
  }, 180_000);

  it('outline lists each board with its id, size and title', () => {
    const out = run(copy(), 'outline', 'project/canvas.json').out;
    expect(out).toMatch(/^screen home "Home" 1280x900/m);
    expect(out).toMatch(/^screen pricing "Pricing \(mobile\)" 390x700/m);
  }, 90_000);

  it('a canvas of an unknown version is a bad call naming the file', () => {
    const d = copy();
    writeFileSync(join(d, 'project/canvas.json'), '{"v": 4, "boards": {}}');
    const r = run(d, 'verify', 'project/canvas.json', '--build', 'build-home.html');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/project\/canvas\.json: .*canvas version 4/);
  }, 90_000);

  it('a single HTML design at two viewports still verifies both without --screen', () => {
    const d = copy();
    const args = ['verify', 'build-home.html', '--build', 'build-home.html', '--viewports', '1280x900,390x844'];
    expect(run(d, ...args).code).toBe(0);
    expect(screensOf(d)).toEqual(['build-home@1280', 'build-home@390']);
  }, 120_000);

  it('the design system: tokens.json gives the palette a build is held to', () => {
    const d = copy();
    expect(run(d, 'verify', 'project/tokens.json', '--build', 'build-home-faulty.html').out).toMatch(
      /#c0392b used 1× is not a design colour/,
    );
    const ok = run(d, 'verify', 'project/tokens.json', '--build', 'build-home.html');
    expect(ok.out).toMatch(/^faithful PASS .* conformity \(indicative\) · claude-design\/design-system@1/);
    // And beside a canvas board, as the skills say.
    const both = ['verify', 'project/canvas.json', '--screen', 'home', '--also', 'project/tokens.json'];
    expect(run(d, ...both, '--build', 'build-home.html').code).toBe(0);
    expect(run(d, ...both, '--build', 'build-home-faulty.html').out).toMatch(/#c0392b used 1× is not a design colour/);
  }, 120_000);
});
