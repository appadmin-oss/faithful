/**
 * Colour: read any CSS colour a design or a browser writes, and measure how far apart two are
 * the way an eye does (CIEDE2000), and how readable one is on another (WCAG contrast).
 *
 * Written here rather than pulled from a library so the engine has no runtime dependencies;
 * the ΔE00 implementation follows Sharma, Wu & Dalal (2005) and is tested against their
 * published pairs.
 */

export interface Rgba {
  r: number; // 0–255
  g: number;
  b: number;
  a: number; // 0–1
}

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  navy: '#000080',
  orange: '#ffa500',
  yellow: '#ffff00',
  purple: '#800080',
  teal: '#008080',
  olive: '#808000',
  lime: '#00ff00',
  aqua: '#00ffff',
  cyan: '#00ffff',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  transparent: '#00000000',
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function num(part: string, scale255 = false): number {
  const p = part.trim();
  if (p.endsWith('%')) return (Number.parseFloat(p) / 100) * (scale255 ? 255 : 1);
  return Number.parseFloat(p);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/**
 * Parse a CSS colour: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() (comma or space syntax),
 * hsl()/hsla(), the basic named colours and `transparent`. Returns null for anything else
 * (a `var()`, `currentColor`, a gradient), so the caller can say "not comparable" rather than
 * guess.
 */
export function parseColor(input: string | undefined | null): Rgba | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (s in NAMED) s = NAMED[s] as string;
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h) || ![3, 4, 6, 8].includes(h.length)) return null;
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
  if (!m) return null;
  const parts = (m[2] as string)
    .replace(/\s*\/\s*/, ',')
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length < 3) return null;
  const alpha = parts[3] !== undefined ? clamp(num(parts[3]), 0, 1) : 1;
  if ((m[1] as string).startsWith('rgb')) {
    const [r, g, b] = parts.slice(0, 3).map((p) => clamp(num(p, true), 0, 255)) as [number, number, number];
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b, a: alpha };
  }
  const h = ((Number.parseFloat(parts[0] as string) % 360) + 360) % 360;
  const sat = clamp(num(parts[1] as string), 0, 1);
  const light = clamp(num(parts[2] as string), 0, 1);
  if ([h, sat, light].some(Number.isNaN)) return null;
  const [r, g, b] = hslToRgb(h, sat, light);
  return { r, g, b, a: alpha };
}

/** Lower-case six-digit hex, alpha dropped. Stable key for palettes and reports. */
export function toHex(c: Rgba): string {
  const h = (v: number) =>
    Math.round(clamp(v, 0, 255))
      .toString(16)
      .padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Composite a translucent colour over a background (default white), as it is seen. */
export function flatten(c: Rgba, over: Rgba = { r: 255, g: 255, b: 255, a: 1 }): Rgba {
  if (c.a >= 1) return c;
  return {
    r: c.r * c.a + over.r * (1 - c.a),
    g: c.g * c.a + over.g * (1 - c.a),
    b: c.b * c.a + over.b * (1 - c.a),
    a: 1,
  };
}

const lin = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.x relative luminance. */
export function luminance(c: Rgba): number {
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG contrast ratio, 1–21. Translucent colours are flattened first (fg over bg, bg over white). */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const b = flatten(bg);
  const f = flatten(fg, b);
  const [hi, lo] = [luminance(f), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export interface Lab {
  L: number;
  a: number;
  b: number;
}

/** sRGB → CIELAB (D65). */
export function toLab(c: Rgba): Lab {
  const r = lin(c.r);
  const g = lin(c.g);
  const b = lin(c.b);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

/** CIEDE2000 colour difference between two Lab colours (kL = kC = kH = 1). */
export function deltaE2000Lab(x: Lab, y: Lab): number {
  const C1 = Math.hypot(x.a, x.b);
  const C2 = Math.hypot(y.a, y.b);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1 = (1 + G) * x.a;
  const a2 = (1 + G) * y.a;
  const C1p = Math.hypot(a1, x.b);
  const C2p = Math.hypot(a2, y.b);
  const hp = (b: number, a: number) => (b === 0 && a === 0 ? 0 : (deg(Math.atan2(b, a)) + 360) % 360);
  const h1 = hp(x.b, a1);
  const h2 = hp(y.b, a2);
  const dL = y.L - x.L;
  const dC = C2p - C1p;
  let dh = 0;
  if (C1p * C2p !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dh / 2));
  const Lbar = (x.L + y.L) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbar = h1 + h2;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1 - h2) <= 180) hbar = (h1 + h2) / 2;
    else hbar = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos(rad(hbar - 30)) +
    0.24 * Math.cos(rad(2 * hbar)) +
    0.32 * Math.cos(rad(3 * hbar + 6)) -
    0.2 * Math.cos(rad(4 * hbar - 63));
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

/** ΔE00 between two CSS colours, both flattened over white; null when either is not a colour. */
export function deltaE(a: string | undefined, b: string | undefined): number | null {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return null;
  return deltaE2000Lab(toLab(flatten(x)), toLab(flatten(y)));
}

/** Is this colour fully transparent (so "no background")? */
export function isTransparent(input: string | undefined): boolean {
  const c = parseColor(input);
  return !c || c.a === 0;
}
