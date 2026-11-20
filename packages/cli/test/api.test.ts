/**
 * The API the CLI and the MCP server share: what it reads, from where, and what it refuses.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareScreens, DEFAULT_CONFIG, formatText, summarise } from '@faithful/core';
import type { DesignElement, Provenance, Screen } from '@faithful/spec';
import { describe, expect, it } from 'vitest';
import {
  audit,
  FaithfulError,
  guard,
  init,
  lastRun,
  loadConfig,
  parseColorScheme,
  parseMax,
  SKILL,
  verify,
  withDeviations,
} from '../src/index.js';

const BIN = resolve(__dirname, '../dist/bin.js');
const run = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 90_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const tmp = () => mkdtempSync(join(tmpdir(), 'faithful-api-'));
const prov: Provenance = {
  adapter: 't',
  adapterVersion: '0',
  format: 't@1',
  tier: 'structured',
  confidence: 1,
  source: 'x',
  warnings: [],
};
const label = (color: string): DesignElement => ({
  id: 'cta',
  kind: 'text',
  text: 'Book now',
  box: { x: 20, y: 20, w: 200, h: 24 },
  style: { color, fontSize: 16 },
});
const screen = (els: DesignElement[]): Screen => ({
  id: 's',
  name: 's',
  viewport: { width: 1280, height: 800 },
  elements: els,
});

describe('--color-scheme', () => {
  it('light (default), dark, or both for audit only; anything else is a bad call', () => {
    expect(parseColorScheme(undefined)).toEqual(['light']);
    expect(parseColorScheme('Dark')).toEqual(['dark']);
    expect(parseColorScheme('both', true)).toEqual(['light', 'dark']);
    expect(() => parseColorScheme('both')).toThrow(FaithfulError);
    for (const bad of ['sepia', 'no-preference', ' '])
      expect(() => parseColorScheme(bad, true), bad).toThrow(/--color-scheme must be light, dark or both/);
  });
});

describe('--max', () => {
  it('a positive whole number, or the call is refused (exit 2), not an empty report', () => {
    expect(parseMax(undefined, 8)).toBe(8);
    expect(parseMax('12', 8)).toBe(12);
    for (const bad of ['abc', '0', '2.5', '-3', ' '])
      expect(() => parseMax(bad, 8), bad).toThrow(/--max must be a positive whole number/);
    const d = tmp();
    const r = run(d, 'formats', '--max', 'abc');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--max must be a positive whole number, got "abc"/);
  });
});

describe('files Faithful reads', () => {
  it('a broken config, baseline or last run names the file and is a bad call (exit 2)', async () => {
    const d = tmp();
    writeFileSync(join(d, 'faithful.config.json'), '{ "passScore": 90, }');
    await expect(loadConfig(d)).rejects.toThrow(FaithfulError);
    await expect(loadConfig(d)).rejects.toThrow(/faithful\.config\.json is not valid JSON/);
    const r = run(d, 'formats');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/faithful\.config\.json is not valid JSON/);
    writeFileSync(join(d, 'faithful.config.json'), '{ "passScore": 500 }');
    await expect(loadConfig(d)).rejects.toThrow(/faithful\.config\.json: passScore should be/);

    const e = tmp();
    writeFileSync(join(e, 'faithful.baseline.json'), '{oops');
    await expect(guard({ cwd: e, files: [] })).rejects.toThrow(/faithful\.baseline\.json is not valid JSON/);
    mkdirSync(join(e, '.faithful'));
    writeFileSync(join(e, '.faithful/last.json'), '');
    await expect(lastRun(e)).rejects.toThrow(/\.faithful\/last\.json is not valid JSON/);
  });

  it('guard refuses files outside the project folder', async () => {
    const d = tmp();
    mkdirSync(join(d, 'src'));
    writeFileSync(join(d, 'src/a.css'), '.a{color:#fff}');
    const outside = tmp();
    writeFileSync(join(outside, 'secret.css'), '.a{color:#000}');
    await expect(guard({ cwd: d, files: ['../x.css'] })).rejects.toThrow(/outside the project folder/);
    await expect(guard({ cwd: d, files: [join(outside, 'secret.css')] })).rejects.toThrow(/outside the project folder/);
    await expect(guard({ cwd: d, files: ['src/../../etc/passwd'] })).rejects.toThrow(/outside the project folder/);
    const ok = await guard({ cwd: d, files: ['src/a.css', join(d, 'src/a.css')] });
    expect(ok.files).toBe(2);
    expect(ok.violations.map((v) => v.file)).toEqual(['src/a.css', 'src/a.css']);
  });
});

describe('declared deviations', () => {
  it('a run whose every difference is declared passes at full score; undeclared it fails', async () => {
    const results = () => [compareScreens(screen([label('#10292c')]), screen([label('#b00020')]), DEFAULT_CONFIG)];
    const d = tmp();
    const before = summarise(await withDeviations(results(), d), prov, 'placed', 90);
    expect(before.pass).toBe(false);
    writeFileSync(
      join(d, 'faithful.deviations.json'),
      JSON.stringify({ deviations: [{ kind: 'color', match: 'Book now', reason: 'brand refresh', owner: 'brand' }] }),
    );
    const after = summarise(await withDeviations(results(), d), prov, 'placed', 90);
    expect(after.pass).toBe(true);
    expect(after.score).toBe(100);
    expect(formatText(after)).toMatch(/^faithful PASS clean · 100% match · 1 note/);
  });

  it('a bad entry is a bad call, naming the entry', async () => {
    const d = tmp();
    writeFileSync(
      join(d, 'faithful.deviations.json'),
      JSON.stringify({ deviations: [{ match: 'Book now', reason: 'r', owner: 'o', expires: 'never' }] }),
    );
    await expect(withDeviations([], d)).rejects.toThrow(FaithfulError);
    await expect(withDeviations([], d)).rejects.toThrow(/entry 1: "expires" must be a date/);
  });
});

describe('verify reads paths from its cwd', () => {
  it('design, build and --also resolve against o.cwd, not the process folder', async () => {
    const d = tmp();
    const page =
      '<!doctype html><html><body style="margin:0;font:16px sans-serif"><h1 style="margin:40px">Choose your plan</h1><p style="margin:0 40px">Cancel any time.</p><p style="margin:0 40px">No fees.</p></body></html>';
    writeFileSync(join(d, 'design-cwd-test.html'), page);
    writeFileSync(join(d, 'build-cwd-test.html'), page);
    writeFileSync(join(d, 'copy-cwd-test.txt'), 'Choose your plan\nCancel any time.\nNo fees.\n');
    expect(process.cwd()).not.toBe(d);
    const r = await verify({
      cwd: d,
      design: 'design-cwd-test.html',
      build: 'build-cwd-test.html',
      also: ['copy-cwd-test.txt'],
      viewports: '800x600',
    });
    expect(r.pass).toBe(true);
    expect(JSON.parse(readFileSync(join(d, '.faithful/last.json'), 'utf8')).pass).toBe(true);
  }, 120_000);

  it('a file:// URL is read as the file it names, for verify and audit', async () => {
    const d = tmp();
    const page =
      '<!doctype html><html lang="en"><body style="margin:0;font:16px sans-serif"><h1 style="margin:40px">Choose your plan</h1></body></html>';
    writeFileSync(join(d, 'page.html'), page);
    const url = pathToFileURL(join(d, 'page.html')).href;
    const r = await verify({ cwd: d, design: url, build: url, viewports: '800x600' });
    expect(r.pass).toBe(true);
    const a = await audit({ cwd: d, target: url, viewports: '800x600' });
    expect(a.findings.filter((f) => f.kind === 'broken')).toEqual([]);
  }, 120_000);
});

describe('init', () => {
  it('keeps a skill the team edited, and says so', async () => {
    const d = tmp();
    mkdirSync(join(d, '.agents/skills/faithful'), { recursive: true });
    writeFileSync(join(d, '.agents/skills/faithful/SKILL.md'), '# Our own notes\n');
    const out = await init(d);
    expect(readFileSync(join(d, '.agents/skills/faithful/SKILL.md'), 'utf8')).toBe('# Our own notes\n');
    expect(out.join('\n')).toMatch(/kept 1 edited skill .*: faithful/);
    // An untouched copy is left as it is, and a missing one is written.
    const e = tmp();
    await init(e);
    expect(readFileSync(join(e, '.agents/skills/faithful/SKILL.md'), 'utf8')).toBe(SKILL);
    expect((await init(e)).join('\n')).toMatch(/skills in \.agents\/skills\/ are current/);
  });
});
