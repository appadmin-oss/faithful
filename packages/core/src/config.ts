/**
 * `faithful.config.json`. Every threshold the checks use lives here with a default, so a team
 * can loosen one rule for a reason and the reason is reviewable in one file — rather than a
 * tolerance hidden in a test or an agent's prompt.
 */

export interface Tolerances {
  /** Position/size: a difference passes when it is at most max(px, pct × the dimension). */
  px: number;
  pct: number;
  /** Text boxes reflow with font rasterisation, so their WIDTH gets a wider allowance. */
  textWidthPx: number;
  textWidthPct: number;
  fontSize: number;
  lineHeight: number;
  radius: number;
  letterSpacing: number;
  /** CIEDE2000. At or below `colorPass` is identical to the eye; above `colorFail` is an error. */
  colorPass: number;
  colorFail: number;
}

export interface GuardConfig {
  /** Glob-free path prefixes or file suffixes to scan, relative to the project root. */
  include: string[];
  exclude: string[];
  /** Files allowed to define raw colours (the token files). */
  tokenFiles: string[];
  /** The type scale, in px at a 16px root. Empty = the type-scale rule only checks units. */
  typeScale: number[];
  /** Rules switched on. */
  rules: Record<string, boolean>;
}

export interface FaithfulConfig {
  viewports: Array<{ name: string; width: number; height: number }>;
  tolerances: Tolerances;
  /** Smallest touch target in CSS px. WCAG 2.2 AA is 24; 44 is the enhanced and the mobile norm. */
  minTarget: number;
  /** Selectors whose subtree is not compared (live data, ads, clocks). */
  ignore: string[];
  /** Score at or above which a run with no errors passes. */
  passScore: number;
  /** How many findings the compact report shows before "+N more". */
  maxFindings: number;
  guards: GuardConfig;
  audit: {
    /** Run axe-core's WCAG 2.2 A/AA rules in `faithful audit` (on by default). */
    axe: boolean;
  };
}

export const DEFAULT_CONFIG: FaithfulConfig = {
  viewports: [{ name: 'desktop', width: 1280, height: 800 }],
  tolerances: {
    px: 2,
    pct: 0.02,
    textWidthPx: 6,
    textWidthPct: 0.06,
    fontSize: 0.5,
    lineHeight: 1,
    radius: 1,
    letterSpacing: 0.2,
    colorPass: 1,
    colorFail: 2.3,
  },
  minTarget: 24,
  ignore: [],
  passScore: 90,
  maxFindings: 8,
  guards: {
    include: ['src', 'app', 'components', 'pages', 'styles', 'templates', 'public'],
    exclude: ['node_modules', 'dist', 'build', 'vendor', '.next', 'coverage', '.faithful'],
    tokenFiles: ['tokens.css', 'theme.css', 'variables.css', 'tokens.json', 'tailwind.config'],
    typeScale: [],
    rules: {
      'no-important': true,
      'no-raw-color': true,
      'type-scale': true,
      'no-uppercase': false,
      'inline-style': false,
    },
  },
  audit: { axe: true },
};

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep-merge a user config over the defaults; unknown keys are an error, not ignored. */
export function resolveConfig(user: unknown): FaithfulConfig {
  if (user === undefined || user === null) return structuredClone(DEFAULT_CONFIG);
  if (!isObj(user)) throw new ConfigError('faithful.config.json must be an object');
  const merge = (base: Json, over: Json, at: string): Json => {
    const out: Json = { ...base };
    for (const [k, v] of Object.entries(over)) {
      if (k === '$schema') continue;
      // Own keys only: "__proto__" or "constructor" are not settings.
      if (!Object.hasOwn(base, k)) throw new ConfigError(`unknown setting ${at}${k}`);
      const b = base[k];
      if (k === 'rules' && isObj(b) && isObj(v)) {
        for (const [id, on] of Object.entries(v)) {
          if (!Object.hasOwn(b, id))
            throw new ConfigError(`unknown rule ${at}rules.${id}; rules are: ${Object.keys(b).join(', ')}`);
          if (typeof on !== 'boolean') throw new ConfigError(`${at}rules.${id} should be true or false`);
        }
        out[k] = { ...b, ...v };
      } else if (isObj(b) && isObj(v)) out[k] = merge(b, v, `${at}${k}.`);
      else if (typeof b !== typeof v || Array.isArray(b) !== Array.isArray(v)) {
        throw new ConfigError(`${at}${k} should be ${Array.isArray(b) ? 'an array' : typeof b}`);
      } else out[k] = v;
    }
    return out;
  };
  const cfg = merge(structuredClone(DEFAULT_CONFIG) as unknown as Json, user, '') as unknown as FaithfulConfig;
  const num = (key: string, v: number, lo: number, hi = Number.POSITIVE_INFINITY, int = false) => {
    if (!Number.isFinite(v) || v < lo || v > hi || (int && !Number.isInteger(v)))
      throw new ConfigError(
        `${key} should be ${int ? 'a whole number' : 'a number'} ${hi === Number.POSITIVE_INFINITY ? `of at least ${lo}` : `from ${lo} to ${hi}`}, got ${JSON.stringify(v)}`,
      );
  };
  num('passScore', cfg.passScore, 0, 100);
  num('maxFindings', cfg.maxFindings, 1, Number.POSITIVE_INFINITY, true);
  num('minTarget', cfg.minTarget, 0);
  for (const [k, v] of Object.entries(cfg.tolerances)) num(`tolerances.${k}`, v, 0, k.endsWith('ct') ? 1 : undefined);
  if (cfg.tolerances.colorPass > cfg.tolerances.colorFail)
    throw new ConfigError('tolerances.colorPass must not exceed colorFail');
  const strings = (key: string, list: unknown[]) => {
    for (const x of list)
      if (typeof x !== 'string') throw new ConfigError(`${key} should list strings, got ${JSON.stringify(x)}`);
  };
  strings('ignore', cfg.ignore);
  strings('guards.include', cfg.guards.include);
  strings('guards.exclude', cfg.guards.exclude);
  strings('guards.tokenFiles', cfg.guards.tokenFiles);
  for (const [i, x] of cfg.guards.typeScale.entries()) num(`guards.typeScale[${i}]`, x, 1);
  if (!cfg.viewports.length) throw new ConfigError('viewports cannot be empty');
  cfg.viewports.forEach((v, i) => {
    if (!isObj(v)) throw new ConfigError(`viewports[${i}] should be { "name", "width", "height" }`);
    for (const k of Object.keys(v))
      if (!['name', 'width', 'height'].includes(k)) throw new ConfigError(`unknown setting viewports[${i}].${k}`);
    if (v.name !== undefined && typeof v.name !== 'string')
      throw new ConfigError(`viewports[${i}].name should be a string`);
    for (const k of ['width', 'height'] as const) {
      const n = v[k] as unknown;
      if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0)
        throw new ConfigError(`viewports[${i}].${k} should be a positive whole number of px, got ${JSON.stringify(n)}`);
    }
    v.name ??= `${v.width}x${v.height}`;
  });
  return cfg;
}
