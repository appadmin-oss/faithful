/**
 * Motion, read the way a design specifies it: which properties each element animates, for
 * how long, along which curve, after which delay, how many times. SERIALISED into the page and
 * run in the probe's isolated world: no imports, no helpers from outside the function.
 *
 * Faithful freezes every animation before it measures geometry (`FREEZE` in capture.ts), so
 * the freeze is lifted for the length of this one synchronous read and put back before the
 * browser can paint: the page never moves, and its declared motion is read unfrozen.
 */

export interface MotionTrack {
  /** The property that moves (`transform`, `opacity`, `all`…), or for an animation its name. */
  p: string;
  /** Duration and delay in ms. */
  d: number;
  l: number;
  /** Easing as the browser reports it: a keyword, `cubic-bezier(…)`, `steps(…)`, `linear(…)`. */
  e: string;
  /** Repeats: a number or "infinite" (animations only). */
  i?: string;
  /** For an animation: the properties its keyframes change (`transform,opacity`). */
  k?: string;
}

export interface MotionReading {
  /** Transitions (`t`), CSS animations (`a`) and animations a script started (`s`). */
  t: MotionTrack[];
  a: MotionTrack[];
  s: MotionTrack[];
}

/**
 * Stamp each element that moves with `data-faithful-motion` (its reading, as JSON), for the
 * extractor to collect. `freeze` is the text of Faithful's freezing stylesheet, so this can
 * find it and lift it. Returns how many elements move, and the readings keyed by CSS path for
 * callers that want them directly (the audit's reduced-motion check).
 */
export function stampMotion(arg: { freeze: string; stamp: boolean }): {
  n: number;
  moving: { sel: string; reading: MotionReading }[];
} {
  const sheets = Array.from(document.querySelectorAll('style')).filter((s) => s.textContent === arg.freeze);
  for (const s of sheets) (s as HTMLStyleElement).disabled = true;
  const ms = (v: string) => {
    const x = Number.parseFloat(v);
    if (!Number.isFinite(x)) return 0;
    return /ms\s*$/.test(v) ? x : x * 1000;
  };
  const list = (v: string) => (v || '').split(/,(?![^(]*\))/).map((x) => x.trim());
  const path = (e: Element): string => {
    const parts: string[] = [];
    let cur: Element | null = e;
    for (let i = 0; cur && cur !== document.body && i < 4; i++) {
      let s = cur.tagName.toLowerCase();
      if (cur.id && /^[a-z][\w-]*$/i.test(cur.id)) {
        parts.unshift(`#${cur.id}`);
        break;
      }
      const cls = Array.from(cur.classList).filter((c) => /^[a-z][\w-]*$/i.test(c))[0];
      if (cls) s += `.${cls}`;
      parts.unshift(s);
      cur = cur.parentElement;
    }
    return parts.join('>');
  };
  const moving: { sel: string; reading: MotionReading }[] = [];
  let n = 0;
  try {
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const s = getComputedStyle(el);
      const r: MotionReading = { t: [], a: [], s: [] };
      const tp = list(s.transitionProperty);
      const td = list(s.transitionDuration);
      const te = list(s.transitionTimingFunction);
      const tl = list(s.transitionDelay);
      tp.forEach((p, i) => {
        const d = ms(td[i % td.length] ?? '0s');
        if (d > 0 && p && p !== 'none')
          r.t.push({
            p,
            d: Math.round(d),
            l: Math.round(ms(tl[i % tl.length] ?? '0s')),
            e: te[i % te.length] ?? 'ease',
          });
      });
      // Animations, CSS and scripted, from the Web Animations API: keyframes say what moves.
      for (const an of el.getAnimations ? el.getAnimations() : []) {
        const fx = an.effect as KeyframeEffect | null;
        if (!fx) continue;
        const t = fx.getTiming();
        const d = typeof t.duration === 'number' ? t.duration : 0;
        if (d <= 0) continue;
        const props = new Set<string>();
        let keyEasing = '';
        try {
          const kf = fx.getKeyframes();
          // A CSS animation's curve is applied per keyframe (animation-timing-function); the
          // effect's own easing is linear. The first keyframe's is the declared one.
          keyEasing = String((kf[0] as { easing?: string } | undefined)?.easing ?? '');
          for (const k of kf)
            for (const key of Object.keys(k))
              if (!/^(offset|easing|composite|computedOffset)$/.test(key))
                props.add(key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
        } catch {
          /* a cross-origin or detached effect: its properties are unknown */
        }
        const css = 'animationName' in an;
        const isTransition = 'transitionProperty' in an;
        if (isTransition) continue; // a running transition is already read from its declaration
        const track: MotionTrack = {
          p: css ? String((an as unknown as { animationName: string }).animationName) : 'script',
          d: Math.round(d),
          l: Math.round(Number(t.delay) || 0),
          e: css && keyEasing ? keyEasing : String(t.easing || 'linear'),
          i: t.iterations === Number.POSITIVE_INFINITY ? 'infinite' : String(t.iterations ?? 1),
          k: [...props].sort().join(','),
        };
        (css ? r.a : r.s).push(track);
      }
      // CSS animations not yet started (a delay, a paused state) are only in the declaration.
      if (!r.a.length && s.animationName && s.animationName !== 'none') {
        const names = list(s.animationName);
        const dd = list(s.animationDuration);
        const ee = list(s.animationTimingFunction);
        const ll = list(s.animationDelay);
        const it = list(s.animationIterationCount);
        names.forEach((name, i) => {
          const d = ms(dd[i % dd.length] ?? '0s');
          if (d > 0 && name !== 'none')
            r.a.push({
              p: name,
              d: Math.round(d),
              l: Math.round(ms(ll[i % ll.length] ?? '0s')),
              e: ee[i % ee.length] ?? 'ease',
              i: it[i % it.length] ?? '1',
            });
        });
      }
      if (!r.t.length && !r.a.length && !r.s.length) continue;
      n++;
      if (arg.stamp) el.setAttribute('data-faithful-motion', JSON.stringify(r));
      if (moving.length < 200) moving.push({ sel: path(el), reading: r });
    }
  } finally {
    for (const s of sheets) (s as HTMLStyleElement).disabled = false;
  }
  if (arg.stamp) document.documentElement.setAttribute('data-faithful-motion-read', '');
  return { n, moving };
}
