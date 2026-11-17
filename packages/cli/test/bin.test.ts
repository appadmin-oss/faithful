/**
 * The CLI as an agent meets it: a process, its stdout and its exit code. 0 is a pass, 1 a
 * fail an agent should fix, 2 a fault in how it was called — a script that cannot tell a
 * failing build from a typo will loop on the typo.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENTS_BLOCK, init, SKILL } from '../src/index.js';

const BIN = resolve(__dirname, '../dist/bin.js');
const run = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 90_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const tmp = () => mkdtempSync(join(tmpdir(), 'faithful-cli-'));
const page = (h: string) =>
  `<!doctype html><html><body style="margin:0;font:16px sans-serif"><h1 style="margin:40px;color:#10292c">${h}</h1><p style="margin:0 40px">Cancel any time.</p></body></html>`;

describe('faithful (bin)', () => {
  it('exit 0 on a faithful build, 1 on a faulty one, 2 on a bad call', () => {
    const d = tmp();
    writeFileSync(join(d, 'design.html'), page('Choose your plan'));
    writeFileSync(join(d, 'same.html'), page('Choose your plan'));
    writeFileSync(join(d, 'off.html'), page('Choose a plan'));
    const ok = run(d, 'verify', 'design.html', '--build', 'same.html', '--viewports', '800x600');
    expect(ok.code).toBe(0);
    expect(ok.out.trim().split('\n')).toHaveLength(1);
    expect(ok.out).toMatch(/^faithful PASS clean · 100% match/);
    const bad = run(d, 'verify', 'design.html', '--build', 'off.html', '--viewports', '800x600');
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/^faithful FAIL 1E/);
    expect(bad.out).toContain('"Choose your plan" → "Choose a plan"');
    expect(existsSync(join(d, '.faithful/last.json'))).toBe(true);
    expect(run(d, 'explain', 'F1').out).toMatch(/^F1 E text/);
    expect(run(d, 'verify', 'design.html').code).toBe(2);
    expect(run(d, 'verify', 'nope.xyz', '--build', 'same.html').code).toBe(2);
    expect(run(d, 'frobnicate').code).toBe(2);
  }, 120_000);

  it('selftest: every guard rule and the comparison catch their planted faults', () => {
    const r = run(tmp(), 'selftest');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^selftest PASS/);
  }, 120_000);
});

describe('init', () => {
  it('writes the config, the skill and one AGENTS.md block, and is idempotent', async () => {
    const d = tmp();
    writeFileSync(join(d, 'AGENTS.md'), '# Project\n\nOur rules.\n');
    await init(d);
    await init(d);
    const agents = readFileSync(join(d, 'AGENTS.md'), 'utf8');
    expect(agents.startsWith('# Project\n\nOur rules.')).toBe(true);
    expect(agents.split('<!-- faithful:begin -->')).toHaveLength(2);
    expect(existsSync(join(d, 'faithful.config.json'))).toBe(true);
    expect(readFileSync(join(d, '.agents/skills/faithful/SKILL.md'), 'utf8')).toBe(SKILL);
  });

  it("never tells an agent to run `npx faithful`: that name on npm is somebody else's package", () => {
    expect(`${SKILL}\n${AGENTS_BLOCK}`).not.toMatch(/npx faithful\b/);
    // The skill must stay small enough to load every time.
    expect(SKILL.split('\n').length).toBeLessThan(100);
  });
});
