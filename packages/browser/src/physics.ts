/**
 * Physics, read the only way it can be: by watching. A spring (Framer Motion, react-spring), a
 * script that tweens a style every frame, a class added on load that sets a transition going —
 * none of them declares a curve a stylesheet can be asked for. What they share is a trajectory:
 * where the element is, how big, how opaque, on every frame until it comes to rest.
 *
 * `recordPhysics` is installed as an init script, so it is watching before the page's own
 * scripts run. It lives in the page's world (it must see the page's style writes) and touches
 * nothing the page can see but one symbol-keyed property. SERIALISED: no imports, no helpers.
 *
 * What it samples: every element a running, finite animation or transition targets, and every
 * element whose `style` attribute a script writes. Infinite animations are loops, not physics,
 * and are left to the motion reader (motion.ts) and the reduced-motion audit.
 */

/** The page-side recorder. Installed with `addInitScript({ content: \`(${recordPhysics})()\` })`. */
export function recordPhysics(): void {
  const KEY = Symbol.for('faithful.physics');
  const w = window as unknown as Record<symbol, unknown>;
  if (w[KEY]) return;
  const MAX_TRACKS = 40;
  const MAX_MS = 6000;
  const t0 = performance.now();
  // Per element: frames of [ms since t0, x, y, w, h, opacity], pushed only when something changed.
  const tracks = new Map<Element, number[][]>();
  const candidates = new Set<Element>();
  // The last value read per element, every frame: a slow tail that moves less than a recorded
  // step per frame is still moving, and the page is not at rest until it stops.
  const seen = new Map<Element, number[]>();
  let lastChange = t0;
  let stopped = false;
  const finite = (a: Animation) => {
    const fx = a.effect as KeyframeEffect | null;
    const it = fx?.getTiming().iterations;
    return !!fx && it !== Number.POSITIVE_INFINITY && !fx.pseudoElement;
  };
  const watch = () => {
    try {
      new MutationObserver((ms) => {
        for (const m of ms) {
          if (m.target.nodeType !== 1) continue;
          const el = m.target as Element;
          candidates.add(el);
          // The first write is where it starts: read it now, before the page's own next frame
          // can move it again (a spring stepped in the same frame would otherwise be sampled
          // already on its way, and every distance would read a step short).
          if (!stopped && !tracks.has(el) && tracks.size < MAX_TRACKS && el.isConnected)
            tracks.set(el, [[Math.round(performance.now() - t0), ...read(el)]]);
        }
      }).observe(document, { attributes: true, attributeFilter: ['style'], subtree: true });
    } catch {
      /* no document yet: the frame loop still finds declared animations */
    }
  };
  if (document.documentElement) watch();
  else document.addEventListener('readystatechange', watch, { once: true });
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const read = (el: Element): number[] => {
    const r = el.getBoundingClientRect();
    const o = Number.parseFloat(getComputedStyle(el).opacity);
    return [
      r2(r.left + window.scrollX),
      r2(r.top + window.scrollY),
      r2(r.width),
      r2(r.height),
      r2(Number.isFinite(o) ? o : 1),
    ];
  };
  const busy = () => {
    if (!document.getAnimations) return false;
    return document.getAnimations().some((a) => finite(a) && (a.playState === 'running' || a.pending));
  };
  const frame = () => {
    if (stopped) return;
    const now = performance.now();
    if (document.getAnimations)
      for (const a of document.getAnimations()) {
        const target = (a.effect as KeyframeEffect | null)?.target;
        if (target && finite(a) && a.playState === 'running') candidates.add(target);
      }
    for (const el of candidates) {
      if (!el.isConnected) continue;
      let f = tracks.get(el);
      if (!f) {
        if (tracks.size >= MAX_TRACKS) continue;
        f = [];
        tracks.set(el, f);
      }
      const v = read(el);
      const prev = f[f.length - 1];
      const moved = !prev || v.some((x, i) => Math.abs(x - (prev[i + 1] as number)) > (i === 4 ? 0.004 : 0.2));
      if (moved) f.push([Math.round(now - t0), ...v]);
      const was = seen.get(el);
      if (was?.some((x, i) => Math.abs(x - (v[i] as number)) > (i === 4 ? 0.001 : 0.02))) lastChange = now;
      seen.set(el, v);
    }
    if (now - t0 > MAX_MS) {
      stopped = true;
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  w[KEY] = {
    /** At rest: nothing has moved for `ms`, nothing finite is still running, and it has watched long enough. */
    quiet: (ms: number) => {
      const now = performance.now();
      return stopped || (now - t0 > 700 && now - lastChange > ms && !busy());
    },
    /** Stamp each element that moved with its trajectory, for the extractor to collect. */
    stamp: () => {
      stopped = true;
      // Where each came to rest, if it crept there in steps too small to record.
      const now = Math.round(performance.now() - t0);
      for (const [el, f] of tracks) {
        if (!el.isConnected || !f.length) continue;
        const v = read(el);
        const last = f[f.length - 1] as number[];
        if (v.some((x, i) => x !== last[i + 1])) f.push([now, ...v]);
      }
      let n = 0;
      for (const [el, f] of tracks) {
        if (f.length < 3 || !el.isConnected) continue;
        // At most 120 frames: every k-th, always keeping the last (where it came to rest).
        const k = Math.ceil(f.length / 120);
        const kept = f.filter((_, i) => i % k === 0 || i === f.length - 1);
        const start = (kept[0] as number[])[0] as number;
        const col = (i: number) => kept.map((x) => x[i] as number);
        el.setAttribute(
          'data-faithful-trajectory',
          JSON.stringify({
            start,
            t: col(0).map((t) => t - start),
            x: col(1),
            y: col(2),
            w: col(3),
            h: col(4),
            o: col(5),
          }),
        );
        n++;
      }
      document.documentElement.setAttribute('data-faithful-physics-read', '');
      return n;
    },
  };
}
