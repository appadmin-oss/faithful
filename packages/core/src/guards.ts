/**
 * Source guards: rules read from the code, not the render, so they catch a fault before
 * anything is built and on screens nobody rendered.
 *
 * Each rule is a pure function of (path, text) and ships PLANTED SAMPLES — code it must flag
 * and code it must leave alone — that `faithful selftest` runs. A sweep is evidence only once
 * it has been seen to name a break: a guard that passes everything looks exactly like a guard
 * protecting a clean codebase.
 *
 * Languages: CSS, SCSS, Less, Sass, Stylus; HTML and the server templates that embed it (Twig,
 * Blade, ERB, Jinja, Nunjucks, Handlebars, Liquid, PHP); JSX/TSX, Vue, Svelte, Astro and CSS-in-JS
 * tagged templates; Swift, Kotlin/Compose and Dart/Flutter for colour and size literals.
 */
import type { GuardConfig } from './config.js';

export interface Violation {
  rule: string;
  file: string;
  line: number;
  text: string;
}

interface Chunk {
  text: string;
  /** Line number of the chunk's first character in the file. */
  line: number;
}

export type Lang = 'css' | 'markup' | 'script' | 'native' | 'other';

const EXT: Array<[RegExp, Lang]> = [
  [/\.(css|scss|sass|less|styl|pcss)$/i, 'css'],
  [
    /\.(html?|twig|blade\.php|erb|jinja2?|j2|njk|hbs|handlebars|mustache|liquid|php|vue|svelte|astro|cshtml|razor)$/i,
    'markup',
  ],
  [/\.(jsx|tsx|js|ts|mjs|cjs)$/i, 'script'],
  [/\.(swift|kt|kts|dart)$/i, 'native'],
];

export function langOf(path: string): Lang {
  for (const [re, l] of EXT) if (re.test(path)) return l;
  return 'other';
}

const lineAt = (text: string, idx: number): number => {
  let n = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
};

/** Stylesheet languages with `//` line comments. Plain CSS has none: `//` there is part of a value. */
const SLASH_CSS = /\.(scss|sass|less|styl)$/i;

/**
 * Blank `//` line comments, but never inside a string or a `url(…)`: `url(//cdn.x/a.png)` in a
 * stylesheet is a protocol-relative address, not the start of a comment that hides the rest of
 * the line.
 */
function stripLineComments(t: string): string {
  let out = '';
  let quote = '';
  let url = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i] as string;
    if (quote) {
      if (c === '\\') {
        out += c + (t[i + 1] ?? '');
        i++;
        continue;
      }
      if (c === quote || c === '\n') quote = '';
      out += c;
      continue;
    }
    if (url) {
      if (c === ')') url = false;
      out += c;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (/^url\($/i.test(t.slice(Math.max(0, i - 3), i + 1))) url = true;
    else if (c === '/' && t[i + 1] === '/' && !/[:\\]/.test(t[i - 1] ?? '')) {
      const end = t.indexOf('\n', i);
      const stop = end < 0 ? t.length : end;
      out += ' '.repeat(stop - i);
      i = stop - 1;
      continue;
    }
    out += c;
  }
  return out;
}

/** Blank out comments, keeping every newline so line numbers stay true. */
function stripComments(text: string, path: string): string {
  const lang = langOf(path);
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  let t = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (lang === 'markup')
    t = t
      .replace(/<!--[\s\S]*?-->/g, blank)
      .replace(/\{#[\s\S]*?#\}/g, blank)
      .replace(/\{\{--[\s\S]*?--\}\}/g, blank);
  if (lang === 'script' || lang === 'native' || (lang === 'css' && SLASH_CSS.test(path))) t = stripLineComments(t);
  return t;
}

/** The parts of a file that are CSS: the whole of a stylesheet, style blocks and attributes, CSS-in-JS. */
export function cssChunks(text: string, lang: Lang): Chunk[] {
  if (lang === 'css') return [{ text, line: 1 }];
  const out: Chunk[] = [];
  const grab = (re: RegExp, group: number) => {
    for (const m of text.matchAll(re)) {
      const g = m[group];
      if (g === undefined || m.index === undefined) continue;
      out.push({ text: g, line: lineAt(text, m.index + m[0].indexOf(g)) });
    }
  };
  if (lang === 'markup') {
    grab(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, 1);
    grab(/\sstyle\s*=\s*"([^"]*)"/gi, 1);
    grab(/\sstyle\s*=\s*'([^']*)'/gi, 1);
  }
  if (lang === 'script' || lang === 'markup') {
    grab(/(?:\bcss|\bstyled(?:\.\w+|\([^)]*\))|createGlobalStyle|keyframes|injectGlobal)\s*`([^`]*)`/g, 1);
  }
  return out;
}

/** CSS declarations in a chunk: [property, value, line]. Selectors are never mistaken for one. */
export function declarations(chunk: Chunk): Array<[string, string, number]> {
  const out: Array<[string, string, number]> = [];
  // A declaration is `prop: value` ending at ; } or end, whose prop is a plain identifier and
  // which is not followed by `{` (that would be a selector with a pseudo-class).
  const re = /(^|[;{\s])(--[\w-]+|-?[a-z][a-z-]*)\s*:\s*([^;{}]*?)\s*(?=;|}|$)/gim;
  for (const m of chunk.text.matchAll(re)) {
    if (m.index === undefined) continue;
    const after = chunk.text.slice(m.index + m[0].length, m.index + m[0].length + 2);
    if (after.startsWith('{') || /\{/.test(m[3] ?? '')) continue;
    out.push([
      (m[2] as string).toLowerCase(),
      m[3] as string,
      chunk.line + lineAt(chunk.text, m.index + (m[1]?.length ?? 0)) - 1,
    ]);
  }
  return out;
}

const HEX = /(^|[^&\w])#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/i;
const FUNC = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;
const isColorValue = (v: string): boolean => {
  const t = v.replace(/url\([^)]*\)/gi, '');
  return HEX.test(t) || FUNC.test(t);
};

export interface Rule {
  id: string;
  summary: string;
  check(path: string, text: string, cfg: GuardConfig): Violation[];
  samples: { bad: Array<[string, string]>; good: Array<[string, string]> };
}

function cssRule(id: string, test: (prop: string, value: string, cfg: GuardConfig, path: string) => string | null) {
  return (path: string, text: string, cfg: GuardConfig): Violation[] => {
    const lang = langOf(path);
    const out: Violation[] = [];
    for (const c of cssChunks(stripComments(text, path), lang)) {
      for (const [p, v, line] of declarations(c)) {
        const msg = test(p, v, cfg, path);
        if (msg) out.push({ rule: id, file: path, line, text: msg });
      }
    }
    return out;
  };
}

/** Lines of a file matching a pattern, for rules that are not about CSS declarations. */
function lines(id: string, path: string, text: string, re: RegExp, msg: (m: RegExpMatchArray) => string): Violation[] {
  const out: Violation[] = [];
  const t = stripComments(text, path);
  for (const m of t.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
    if (m.index === undefined) continue;
    out.push({ rule: id, file: path, line: lineAt(t, m.index), text: msg(m) });
  }
  return out;
}

const isTokenFile = (path: string, cfg: GuardConfig): boolean =>
  cfg.tokenFiles.some((t) => path.endsWith(t) || path.includes(`/${t}`));

/** Font size of a CSS value in px at a 16px root, or a reason it cannot be judged. */
export function fontSizePx(value: string): number | 'fluid' | null {
  const v = value.trim().toLowerCase();
  if (/\b(clamp|min|max)\(|\d(vw|vh|vmin|vmax|svw|lvw|dvw|cqw|cqi|cqh)\b/.test(v)) return 'fluid';
  const m = /^(-?\d*\.?\d+)(px|rem)\b/.exec(v);
  if (!m) return null;
  const n = Number.parseFloat(m[1] as string);
  return m[2] === 'rem' ? n * 16 : n;
}

/** The size inside a `font:` shorthand is the first length, before any `/line-height`. */
const shorthandSize = (value: string): string | null => {
  const m = /(?:^|\s)((?:\d*\.?\d+)(?:px|rem|em|%|vw|vh|vmin|vmax|cqw)|clamp\([^)]*\))(?:\s*\/|\s|$)/i.exec(value);
  return m ? (m[1] as string) : null;
};

export const RULES: Rule[] = [
  {
    id: 'no-important',
    summary: '`!important` is a fight with the cascade the next person loses; raise specificity or fix the order.',
    check: (path, text) => {
      const lang = langOf(path);
      if (lang === 'native' || lang === 'other') return [];
      return lines('no-important', path, text, /!\s*important\b/i, () => '!important');
    },
    samples: {
      bad: [
        ['a.css', '.x { color: red !important; }'],
        ['a.tsx', "const s = { color: 'red !important' };"],
        ['a.html', '<p style="margin:0 ! important">x</p>'],
      ],
      good: [['a.css', '/* never !important */ .x { color: red; }']],
    },
  },
  {
    id: 'no-raw-color',
    summary: 'A colour is typed in one place (the token file) and read everywhere else by name.',
    check: (path, text, cfg) => {
      if (isTokenFile(path, cfg)) return [];
      const lang = langOf(path);
      if (lang === 'native') {
        return lines(
          'no-raw-color',
          path,
          text,
          /\bColor\(\s*0x[0-9a-f]{6,8}\s*\)|\b(?:UI|NS)?Color\(\s*red:|#colorLiteral|Color\(\s*red\s*=|\bColor\.fromARGB\(|\bColor\.fromRGBO\(/i,
          (m) => m[0],
        );
      }
      const css = cssRule('no-raw-color', (p, v) =>
        !p.startsWith('--') && isColorValue(v) ? `${p}: ${v.slice(0, 40)}` : null,
      )(path, text, cfg);
      if (lang !== 'script' && lang !== 'markup') return css;
      // JS style objects, theme objects and props: a quoted string that IS a colour. A six- or
      // eight-digit hex or a colour function is one wherever it is; a three-digit one only beside
      // a colour-ish key, because `href="#add"` and `'#bad'` are words.
      const js = [
        ...lines(
          'no-raw-color',
          path,
          text,
          /['"`](#(?:[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?|oklch|oklab)\([^'"`)]*\))['"`]/i,
          (m) => m[1] as string,
        ),
        ...lines(
          'no-raw-color',
          path,
          text,
          /(?:colou?r|background|bg|fill|stroke|border|shadow|tint|accent|fg)\w*['"]?\s*[:=]\s*\{?\s*['"`](#[0-9a-f]{3,4})['"`]/i,
          (m) => m[1] as string,
        ),
      ];
      const seen = new Set(css.map((v) => v.line));
      return [...css, ...js.filter((v) => !seen.has(v.line))];
    },
    samples: {
      bad: [
        ['a.css', '.x { color: #10292c; }'],
        ['a.scss', '.x { background: rgba(0,0,0,.5); }'],
        ['a.vue', '<template><b style="color:#fff">x</b></template>'],
        ['a.tsx', "<b style={{ color: '#ff0000' }} />"],
        ['a.tsx', "<b style={{ color: '#f00' }} />"],
        ['theme.ts', "export const theme = { primary: '#10292c' };"],
        ['a.ts', 'const Title = styled.h1`color: hsl(10 50% 50%);`'],
        ['a.dart', 'final c = Color(0xFF10292C);'],
        ['a.swift', 'let c = Color(red: 0.1, green: 0.2, blue: 0.3)'],
      ],
      good: [
        ['a.css', '#main { color: var(--ink); }'],
        ['tokens.css', ':root { --ink: #10292c; }'],
        ['a.css', ':root { --ink: #10292c; }'],
        ['a.html', '<a href="#add">Add</a> &#123;'],
        ['a.tsx', '<a href="#add">Add</a>'],
        ['a.vue', '<template><a href="#bad">x</a></template>'],
        ['a.css', '.x { background: url(https://example.com/#fff); }'],
      ],
    },
  },
  {
    id: 'type-scale',
    summary:
      "Type sizes come from the scale and never from the viewport (`vw`, `clamp()`), which ignores the reader's text setting.",
    check: (path, text, cfg) => {
      const lang = langOf(path);
      if (lang === 'native') {
        if (!cfg.typeScale.length) return [];
        return lines(
          'type-scale',
          path,
          text,
          /\b(?:fontSize\s*[:=]\s*|size:\s*|\.system\(size:\s*)(\d+(?:\.\d+)?)/,
          (m) => m[0],
        ).filter((v) => {
          const n = Number.parseFloat(/(\d+(?:\.\d+)?)/.exec(v.text)?.[1] ?? 'NaN');
          return !cfg.typeScale.some((s) => Math.abs(s - n) < 0.01);
        });
      }
      const judge = (raw: string): string | null => {
        const px = fontSizePx(raw);
        if (px === 'fluid') return `font-size ${raw} scales with the viewport`;
        if (px === null || !cfg.typeScale.length) return null;
        return cfg.typeScale.some((s) => Math.abs(s - px) < 0.01)
          ? null
          : `font-size ${raw} (${px}px) is off the scale ${cfg.typeScale.join('/')}`;
      };
      const out = cssRule('type-scale', (p, v) => {
        if (p === 'font-size') return judge(v);
        if (p === 'font') {
          const s = shorthandSize(v);
          return s ? judge(s) : null;
        }
        return null;
      })(path, text, cfg);
      if (lang === 'script') {
        out.push(
          ...lines('type-scale', path, text, /\bfontSize\s*:\s*['"]([^'"]+)['"]/, (m) => m[1] as string)
            .map((v) => ({ ...v, text: judge(v.text) ?? '' }))
            .filter((v) => v.text),
        );
      }
      return out;
    },
    samples: {
      bad: [
        ['a.css', 'h1 { font-size: clamp(2rem, 5vw, 4rem); }'],
        ['a.css', 'h1 { font: 700 4vw/1.1 serif; }'],
        ['a.tsx', "const s = { fontSize: '3vw' };"],
      ],
      good: [
        ['a.css', 'h1 { font-size: 2rem; } @media (min-width: 900px) { h1 { font-size: 2.75rem; } }'],
        ['a.css', '.wide { width: 50vw; }'],
      ],
    },
  },
  {
    id: 'no-uppercase',
    summary:
      'Capitals are written in the copy, not painted by CSS: screen readers spell transformed text, and the copy stops matching the design.',
    check: cssRule('no-uppercase', (p, v) =>
      (p === 'text-transform' && /uppercase|capitalize/i.test(v)) ||
      (p === 'font-variant' && /small-caps/i.test(v)) ||
      (p === 'font-variant-caps' && /small-caps/i.test(v))
        ? `${p}: ${v}`
        : null,
    ),
    samples: {
      bad: [
        ['a.css', '.k { text-transform: uppercase; }'],
        ['a.html', '<b style="font-variant: small-caps">x</b>'],
      ],
      good: [['a.css', '.k { text-transform: none; }']],
    },
  },
  {
    id: 'inline-style',
    summary: 'Styles live in classes; an inline style is a value nothing else can find or change.',
    check: (path, text) => {
      const lang = langOf(path);
      if (lang === 'markup') return lines('inline-style', path, text, /\sstyle\s*=\s*["']/i, () => 'style="…"');
      if (lang === 'script') return lines('inline-style', path, text, /\sstyle\s*=\s*\{\{/, () => 'style={{…}}');
      return [];
    },
    samples: {
      bad: [
        ['a.html', '<p style="margin:0">x</p>'],
        ['a.jsx', '<p style={{ margin: 0 }}>x</p>'],
      ],
      good: [
        ['a.html', '<p class="m0">x</p>'],
        ['a.jsx', '<p style={vars}>x</p>'],
      ],
    },
  },
];

export function enabledRules(cfg: GuardConfig): Rule[] {
  return RULES.filter((r) => cfg.rules[r.id] === true);
}

export function scanFile(path: string, text: string, cfg: GuardConfig): Violation[] {
  if (langOf(path) === 'other') return [];
  return enabledRules(cfg).flatMap((r) => r.check(path, text, cfg));
}

/** Per-rule, per-file counts: what a baseline stores. */
export type Baseline = Record<string, Record<string, number>>;

export function countViolations(vs: Violation[]): Baseline {
  const b: Baseline = {};
  for (const v of vs) {
    b[v.rule] ??= {};
    const r = b[v.rule] as Record<string, number>;
    r[v.file] = (r[v.file] ?? 0) + 1;
  }
  return b;
}

export interface Ratchet {
  /** Files where a rule now has MORE violations than the baseline allows. */
  regressions: Array<{ rule: string; file: string; was: number; now: number; lines: Violation[] }>;
  /** Files that improved: the baseline can be tightened. */
  improved: Array<{ rule: string; file: string; was: number; now: number }>;
}

/**
 * Compare against a baseline. Existing debt is allowed to stay and never to grow: a file may
 * only go down. This is what lets a guard be switched on in a codebase that already breaks it.
 */
export function ratchet(vs: Violation[], baseline: Baseline): Ratchet {
  const now = countViolations(vs);
  const regressions: Ratchet['regressions'] = [];
  const improved: Ratchet['improved'] = [];
  for (const [rule, files] of Object.entries(now)) {
    for (const [file, n] of Object.entries(files)) {
      const was = baseline[rule]?.[file] ?? 0;
      if (n > was)
        regressions.push({ rule, file, was, now: n, lines: vs.filter((v) => v.rule === rule && v.file === file) });
    }
  }
  for (const [rule, files] of Object.entries(baseline)) {
    for (const [file, was] of Object.entries(files)) {
      const n = now[rule]?.[file] ?? 0;
      if (n < was) improved.push({ rule, file, was, now: n });
    }
  }
  return { regressions, improved };
}

/** Run every rule's planted samples. Returns the failures; empty means every rule can see. */
export function selftestRules(cfg: GuardConfig): string[] {
  const failures: string[] = [];
  const all: GuardConfig = {
    ...cfg,
    rules: Object.fromEntries(RULES.map((r) => [r.id, true])),
    typeScale: cfg.typeScale,
  };
  for (const r of RULES) {
    for (const [file, code] of r.samples.bad) {
      if (r.check(file, code, all).length === 0)
        failures.push(`${r.id} missed a planted violation in ${file}: ${code}`);
    }
    for (const [file, code] of r.samples.good) {
      const v = r.check(file, code, all);
      if (v.length) failures.push(`${r.id} flagged clean code in ${file}: ${code} (${v[0]?.text})`);
    }
  }
  return failures;
}
