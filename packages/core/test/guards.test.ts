import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import { countViolations, declarations, fontSizePx, langOf, ratchet, scanFile, selftestRules } from '../src/guards.js';

const all = {
  ...DEFAULT_CONFIG.guards,
  rules: { 'no-important': true, 'no-raw-color': true, 'type-scale': true, 'no-uppercase': true, 'inline-style': true },
};

describe('guards', () => {
  it('every rule sees every planted violation and passes every planted clean sample', () => {
    expect(selftestRules(DEFAULT_CONFIG.guards)).toEqual([]);
  });

  it('the selftest can fail: a blind rule is reported', async () => {
    const g = await import('../src/guards.js');
    const rule = g.RULES.find((r) => r.id === 'no-important');
    if (!rule) throw new Error('rule missing');
    const real = rule.check;
    rule.check = () => [];
    try {
      expect(selftestRules(DEFAULT_CONFIG.guards).some((f) => f.startsWith('no-important missed'))).toBe(true);
    } finally {
      rule.check = real;
    }
  });

  it('reports the right line', () => {
    const v = scanFile('a.css', '.a{}\n\n.b { color: #fff; }\n', all);
    expect(v).toEqual([{ rule: 'no-raw-color', file: 'a.css', line: 3, text: 'color: #fff' }]);
  });

  it('does not read a selector with a pseudo-class as a declaration', () => {
    expect(
      declarations({ text: 'a:hover { color: red } .b:focus-visible{outline:0}', line: 1 }).map((d) => d[0]),
    ).toEqual(['color', 'outline']);
  });

  it('ignores comments, keeping line numbers', () => {
    expect(scanFile('a.css', '/* color: #fff !important */\n.a { color: var(--x); }', all)).toEqual([]);
    expect(scanFile('a.ts', "// '#ffffff'\nconst u = 'https://x.test/#abc';", all)).toEqual([]);
  });

  it('`//` is a comment only where the language has one, and never inside url() or a string', () => {
    const rules = (file: string, src: string) => scanFile(file, src, all).map((v) => `${v.rule}:${v.line}`);
    // Plain CSS has no line comments: a protocol-relative url must not hide the rest of the line.
    expect(rules('a.css', '.a{background:url(//cdn.x/a.png);color:#fff}')).toEqual(['no-raw-color:1']);
    expect(rules('a.css', '.a{content:"//";color:#fff !important}')).toEqual(['no-important:1', 'no-raw-color:1']);
    // SCSS and Less do have them…
    expect(rules('a.scss', '// color: #fff\n.a{color:var(--x)}')).toEqual([]);
    expect(rules('a.less', '.a{color:var(--x)} // #fff')).toEqual([]);
    // …but not inside url() there either.
    expect(rules('a.scss', '.a{background:url(//cdn.x/a.png);color:#fff}')).toEqual(['no-raw-color:1']);
    expect(rules('a.ts', 'const A = styled.div`background:url(//cdn.x/a.png); color: #fff`;')).toEqual([
      'no-raw-color:1',
    ]);
    expect(rules('a.ts', '// const A = styled.div`color: #fff`;')).toEqual([]);
  });

  it('reads the type scale in px and rem, and refuses viewport type', () => {
    expect(fontSizePx('1rem')).toBe(16);
    expect(fontSizePx('14px')).toBe(14);
    expect(fontSizePx('clamp(1rem, 2vw, 2rem)')).toBe('fluid');
    expect(fontSizePx('var(--x)')).toBeNull();
    const cfg = { ...all, typeScale: [12, 14, 16, 20] };
    expect(scanFile('a.css', '.a{font-size:15px}.b{font-size:.875rem}', cfg).map((v) => v.text)).toEqual([
      'font-size 15px (15px) is off the scale 12/14/16/20',
    ]);
  });

  it('knows languages by extension', () => {
    expect(langOf('x.blade.php')).toBe('markup');
    expect(langOf('x.module.scss')).toBe('css');
    expect(langOf('x.kt')).toBe('native');
    expect(langOf('x.md')).toBe('other');
  });

  it('ratchets: existing debt may stay and shrink, never grow', () => {
    const now = scanFile('a.css', '.a{color:#fff}.b{color:#000}', all);
    const base = countViolations(scanFile('a.css', '.a{color:#fff}', all));
    const r = ratchet(now, base);
    expect(r.regressions).toHaveLength(1);
    expect(r.regressions[0]).toMatchObject({ rule: 'no-raw-color', file: 'a.css', was: 1, now: 2 });
    const better = ratchet([], base);
    expect(better.regressions).toEqual([]);
    expect(better.improved).toEqual([{ rule: 'no-raw-color', file: 'a.css', was: 1, now: 0 }]);
  });
});
