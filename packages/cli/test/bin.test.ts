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
import { AGENTS_BLOCK, init, SKILL, SKILLS } from '../src/index.js';

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

  it('--color-scheme: dark-only faults are caught in dark and in both, labelled by scheme; a bad value is exit 2', () => {
    const d = tmp();
    writeFileSync(
      join(d, 'theme.html'),
      '<!doctype html><html lang="en"><head><title>t</title><style>body{background:#fff;color:#111;font:17px/1.5 Georgia}@media (prefers-color-scheme: dark){body{background:#151515}}</style></head><body><main><p>Readable only in the light theme.</p></main></body></html>',
    );
    expect(run(d, 'audit', 'theme.html', '--viewports', '800x600').code).toBe(0);
    expect(run(d, 'audit', 'theme.html', '--viewports', '800x600', '--color-scheme', 'light').code).toBe(0);
    // With the default zoom and reflow passes each scheme has three screens; these assertions are about schemes.
    const dark = run(d, 'audit', 'theme.html', '--viewports', '800x600', '--color-scheme', 'dark');
    expect(dark.code).toBe(1);
    expect(dark.out).toMatch(/E contrast: "Readable only in the light theme\." #111111 on #151515/);
    const both = run(d, 'audit', 'theme.html', '--viewports', '800x600', '--color-scheme', 'both', '--stress', 'none');
    expect(both.code).toBe(1);
    const last = JSON.parse(readFileSync(join(d, '.faithful/last.json'), 'utf8'));
    expect(last.screens.map((s: { screen: string }) => s.screen)).toEqual(['audit@800 light', 'audit@800 dark']);
    expect(run(d, 'explain', 'F1').out).toContain('screen: audit@800 dark at 800x600 dark');
    expect(run(d, 'audit', 'theme.html', '--color-scheme', 'sepia').code).toBe(2);
    // verify takes light or dark, never both.
    expect(run(d, 'verify', 'theme.html', '--build', 'theme.html', '--color-scheme', 'both').code).toBe(2);
    // verify renders design and build in the scheme asked for: a dark-themed design matches a
    // build hard-coded to its dark colour only in dark.
    const t = (css: string) =>
      `<!doctype html><html><body style="margin:0;font:16px sans-serif"><h1 style="margin:40px">Choose your plan</h1><style>${css}</style></body></html>`;
    writeFileSync(join(d, 'design.html'), t('h1{color:#10292c}@media (prefers-color-scheme: dark){h1{color:#2a6f2a}}'));
    writeFileSync(join(d, 'build.html'), t('h1{color:#2a6f2a}'));
    const args = ['verify', 'design.html', '--build', 'build.html', '--viewports', '800x600'];
    expect(run(d, ...args).code).toBe(1);
    expect(run(d, ...args, '--color-scheme', 'dark').code).toBe(0);
  }, 120_000);

  it('--stress: faults only a stress pass finds are reported once, labelled by pass; a bad value is exit 2', () => {
    const d = tmp();
    writeFileSync(
      join(d, 'i18n.html'),
      '<!doctype html><html lang="en"><head><title>t</title><style>body{margin:0;font:16px/1.5 Georgia;background:#fff;color:#111}main{padding:20px}.save{width:96px;white-space:nowrap;overflow:hidden;padding:12px 0;background:#1d4ed8;color:#fff;border:0;font:16px Georgia}</style></head><body><main><p>Your changes are kept for a week.</p><button class="save">Save draft</button></main></body></html>',
    );
    expect(run(d, 'audit', 'i18n.html', '--viewports', '375x812', '--stress', 'none').code).toBe(0);
    const r = run(
      d,
      'audit',
      'i18n.html',
      '--viewports',
      '375x812,800x600',
      '--stress',
      'expand,rtl,spacing',
      '--color-scheme',
      'both',
    );
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^faithful FAIL 1E 0W/);
    expect(r.out).toMatch(/E clipped: with text 1\.3–2× longer, as in translation: "Šàvé dràft/);
    const last = JSON.parse(readFileSync(join(d, '.faithful/last.json'), 'utf8'));
    expect(last.screens.map((s: { screen: string }) => s.screen)).toEqual(
      ['light', 'dark'].flatMap((c) =>
        ['375', '800'].flatMap((w) => ['', ' expand', ' rtl', ' spacing'].map((m) => `audit@${w} ${c}${m}`)),
      ),
    );
    expect(last.findings[0].viewport).toBe(
      '375x812 light expand,800x600 light expand,375x812 dark expand,800x600 dark expand',
    );
    // A pass the page refuses is said, not passed off as clean.
    writeFileSync(
      join(d, 'ltr.html'),
      '<!doctype html><html lang="en"><head><title>t</title><style>body{direction:ltr!important}</style></head><body><main><p>Always left to right.</p></main></body></html>',
    );
    const refused = run(d, 'audit', 'ltr.html', '--viewports', '800x600', '--stress', 'rtl');
    expect(refused.out).toMatch(/W unmeasured: the rtl pass could not be applied/);
    const bad = run(d, 'audit', 'i18n.html', '--stress', 'expand,huge');
    expect(bad.code).toBe(2);
    expect(bad.err).toMatch(/--stress takes a comma list of expand, rtl, spacing, zoom, reflow; got "expand,huge"/);
  }, 180_000);

  it('axe-core: a fault only axe sees fails the audit; --no-axe or audit.axe: false skips it and says so', () => {
    const d = tmp();
    writeFileSync(
      join(d, 'form.html'),
      '<!doctype html><html lang="en"><head><title>t</title><style>body{font:17px/1.5 Georgia}input{height:30px}</style></head><body><main><h1>Plots</h1><form><input name="plot"></form></main></body></html>',
    );
    const on = run(d, 'audit', 'form.html', '--viewports', '800x600');
    expect(on.code).toBe(1);
    expect(on.out).toContain('E a11y: label: Form elements must have labels [input]');
    expect(run(d, 'explain', 'F1').out).toContain('more: https://dequeuniversity.com/rules/axe/');
    const off = run(d, 'audit', 'form.html', '--viewports', '800x600', '--no-axe');
    expect(off.code).toBe(0);
    expect(off.out).toContain('reader: axe-core off (--no-axe): WCAG rules unmeasured');
    writeFileSync(join(d, 'faithful.config.json'), '{ "audit": { "axe": false } }');
    const cfg = run(d, 'audit', 'form.html', '--viewports', '800x600');
    expect(cfg.code).toBe(0);
    expect(cfg.out).toContain('axe-core off (audit.axe: false)');
    writeFileSync(join(d, 'faithful.config.json'), '{ "audit": { "axe": "off" } }');
    expect(run(d, 'audit', 'form.html').code).toBe(2);
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
    for (const name of Object.keys(SKILLS))
      expect(existsSync(join(d, `.agents/skills/${name}/SKILL.md`)), name).toBe(true);
  });

  it("never tells an agent to run `npx faithful`: that name on npm is somebody else's package", () => {
    expect(`${SKILL}\n${AGENTS_BLOCK}`).not.toMatch(/npx faithful\b/);
    // The skill must stay small enough to load every time.
    expect(SKILL.split('\n').length).toBeLessThan(100);
  });
});

describe('faithful parity (bin) with a deviations file', () => {
  it('fails on an undeclared rename, passes once the team declares it', () => {
    const d = tmp();
    const fx = resolve(__dirname, '../../../fixtures/parity');
    writeFileSync(join(d, 'before.html'), readFileSync(join(fx, 'before.html'), 'utf8'));
    writeFileSync(join(d, 'after.html'), readFileSync(join(fx, 'after-good.html'), 'utf8'));
    const first = run(d, 'parity', '--before', 'before.html', '--after', 'after.html');
    expect(first.out).toMatch(/renamed: link "My orders" is now "Your orders"/);
    writeFileSync(
      join(d, 'faithful.deviations.json'),
      JSON.stringify({ deviations: [{ kind: 'renamed', match: 'My orders', reason: 'copy review', owner: 'design' }] }),
    );
    const second = run(d, 'parity', '--before', 'before.html', '--after', 'after.html');
    expect(second.code).toBe(0);
    expect(second.out).toMatch(/^faithful PASS clean/);
    writeFileSync(join(d, 'faithful.deviations.json'), '{"deviations":[{"match":"x"}]}');
    expect(run(d, 'parity', '--before', 'before.html', '--after', 'after.html').code).toBe(2);
  }, 120_000);
});

describe('behaviour on scroll (MAM Academy, Nov 2026)', () => {
  // The design's header: over the hero only the wordmark and two buttons; once the hero has
  // scrolled past, the full bar slides in. `full` builds both states; `stuck` gets the top
  // right and never brings the bar in.
  const header = (swaps: boolean) => `<!doctype html><html lang="en"><head><title>Academy</title><style>
body{margin:0;font:16px/1.5 Georgia;color:#10292c;background:#fbf7ef}
#top{position:fixed;top:0;left:0;right:0;height:56px;display:flex;gap:24px;align-items:center;padding:0 24px;background:#fbf7ef}
#bar{position:fixed;top:0;left:0;right:0;height:64px;display:none;gap:24px;align-items:center;padding:0 24px;background:#10292c;color:#fbf7ef}
#bar a{color:#fbf7ef}.hero{height:900px;padding:120px 24px 0}.more{height:1400px;padding:24px}</style></head><body>
<div id="top"><b>Academy</b><a href="/menu">Menu</a><a href="/apply">Apply</a></div>
<nav id="bar"><b>Academy</b><a href="/programmes">Programmes</a><a href="/about">About</a><a href="/life">Life</a></nav>
<section class="hero"><h1>Where musicians become complete artists</h1></section><section class="more"><p>Lessons every week.</p></section>
<script>${swaps ? "addEventListener('scroll',()=>{const past=scrollY>600;document.getElementById('bar').style.display=past?'flex':'none';document.getElementById('top').style.display=past?'none':'flex'});" : ''}</script>
</body></html>`;

  it('a header that never changes passes at the top and fails once scrolled; the right one passes both', () => {
    const d = tmp();
    writeFileSync(join(d, 'design.html'), header(true));
    writeFileSync(join(d, 'full.html'), header(true));
    writeFileSync(join(d, 'stuck.html'), header(false));
    const vp = ['--viewports', '1280x800'];
    // The trap: at the top the two are the same page.
    expect(run(d, 'verify', 'design.html', '--build', 'stuck.html', ...vp).code).toBe(0);
    const scrolled = run(d, 'verify', 'design.html', '--build', 'stuck.html', ...vp, '--scroll', '0,900');
    expect(scrolled.code).toBe(1);
    expect(scrolled.out).toMatch(/missing: control "Programmes" at 112,9\d\d /);
    const last = JSON.parse(readFileSync(join(d, '.faithful/last.json'), 'utf8'));
    expect(last.screens.map((s: { screen: string }) => s.screen)).toEqual(['design@1280', 'design@1280 scrolled 900']);
    expect(run(d, 'verify', 'design.html', '--build', 'full.html', ...vp, '--scroll', '0,900').code).toBe(0);
    expect(run(d, 'verify', 'design.html', '--build', 'full.html', '--scroll', '0,-5').code).toBe(2);
  }, 180_000);

  it('`faithful verify` with no design re-checks every page in "checks", in one verdict', () => {
    const d = tmp();
    writeFileSync(join(d, 'design.html'), header(true));
    writeFileSync(join(d, 'full.html'), header(true));
    writeFileSync(join(d, 'stuck.html'), header(false));
    const checks = (build: string) =>
      writeFileSync(
        join(d, 'faithful.config.json'),
        JSON.stringify({
          checks: [{ name: 'home', design: 'design.html', build, viewports: '1280x800', scroll: '0,900' }],
        }),
      );
    checks('full.html');
    expect(run(d, 'verify').code).toBe(0);
    checks('stuck.html');
    const r = run(d, 'verify');
    expect(r.code).toBe(1);
    expect(
      JSON.parse(readFileSync(join(d, '.faithful/last.json'), 'utf8')).screens.map((s: { screen: string }) => s.screen),
    ).toEqual(['home · design@1280', 'home · design@1280 scrolled 900']);
    writeFileSync(join(d, 'faithful.config.json'), JSON.stringify({ checks: [] }));
    expect(run(d, 'verify').code).toBe(2);
  }, 180_000);
});
