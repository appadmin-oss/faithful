/**
 * The facts `faithful audit` reads off a rendered page with no design to compare against.
 * SERIALISED with Function#toString and run in the page, so it must stay self-contained.
 *
 * It only MEASURES. Every judgement — what counts as clipped, how many tells make a page read
 * as generated — is made in `@usefaithful/core`'s `scoreAudit()`, where it can be tested without
 * a browser and tuned without re-rendering anything.
 */
import type { AuditFacts } from '@usefaithful/core';

export function auditProbe(): AuditFacts {
  /*
   * The width the reader has. A phone that honours `width=device-width` and finds content
   * wider than the screen zooms the page OUT to fit (Android Chrome; Playwright's isMobile
   * does the same), so innerWidth grows with the overflow and would hide it: the screen's own
   * width is the measure then. With no viewport meta the page is laid out at ~980px on
   * purpose, and that layout width is the measure (its own finding says why it is wrong).
   */
  const W = document.querySelector('meta[name="viewport"]')
    ? Math.min(window.innerWidth, window.screen.width || window.innerWidth)
    : window.innerWidth;
  const H = window.innerHeight;
  const cs = (e: Element) => getComputedStyle(e);
  const path = (e: Element): string => {
    const parts: string[] = [];
    let cur: Element | null = e;
    for (let i = 0; cur && cur !== document.body && i < 4; i++) {
      let s = cur.tagName.toLowerCase();
      if (cur.id && /^[a-z][\w-]*$/i.test(cur.id)) {
        parts.unshift(`${s}#${cur.id}`);
        break;
      }
      const cls = Array.from(cur.classList).find((c) => /^[a-z][\w-]*$/i.test(c));
      if (cls) s += `.${cls}`;
      const parent: Element | null = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur?.tagName);
        if (same.length > 1) s += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(s);
      cur = parent;
    }
    return parts.join('>');
  };
  const short = (t: string, n = 60) => {
    const s = t.replace(/\s+/g, ' ').trim();
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  };
  // Skipped content is laid out but never painted: a closed <details> (Chromium hides it with
  // content-visibility: hidden, so its children keep boxes), or any content-visibility subtree.
  // The browser's own checkVisibility() knows; a box with a size does not.
  const paintedNow = (e: Element) =>
    typeof (e as Element & { checkVisibility?: () => boolean }).checkVisibility !== 'function' ||
    (e as Element & { checkVisibility: () => boolean }).checkVisibility();
  const shown = (e: Element) => {
    const s = cs(e);
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return false;
    if (!paintedNow(e)) return false;
    const r = e.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  // Not judged: hidden from everyone, or marked data-faithful-ignore by the page's author.
  const ariaHidden = (e: Element) =>
    !!e.closest('[aria-hidden="true"],[hidden],template,noscript,[data-faithful-ignore]');
  const opacityOf = (e: Element) => {
    let o = 1;
    for (let c: Element | null = e; c; c = c.parentElement) o *= Number.parseFloat(cs(c).opacity || '1');
    return o;
  };
  const ownText = (e: Element) =>
    Array.from(e.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  // Screen-reader-only text is clipped to 1px on purpose.
  const srOnly = (e: Element) => {
    const r = e.getBoundingClientRect();
    return r.width <= 2 || r.height <= 2;
  };
  /*
   * Why a layout fault may not be what it looks like, decided from the page's own structure,
   * never dropped silently: the audit says what it is and judges it as that.
   *   hidden      not on screen now (opacity ~0, inert, clipped to nothing as visually-hidden text)
   *   decorative  a picture of UI: inside role=img/presentation, or a box that takes no pointer
   *               and holds no control, or one its author named an illustration or mockup
   *   marquee     a clipping window whose text repeats or moves forever (it stands still,
   *               cut off, for a reader who asked for less motion)
   *   stacked     the lower text is behind an opaque layer (a deck, a carousel): occluded
   *   layered     both texts belong to one heading, paragraph or control (layered type)
   *   label       a field drawn over its own label (a floating label)
   */
  type Ctx = 'hidden' | 'decorative' | 'marquee' | 'stacked' | 'layered' | 'label';
  const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
  const isHiddenNow = (e: Element) => {
    if (opacityOf(e) < 0.05 || e.closest('[inert]')) return true;
    for (let c: Element | null = e; c && c !== document.body; c = c.parentElement) {
      const st = cs(c);
      if (/rect\(0(px)?,? 0(px)?|inset\(50%/.test(`${st.clip} ${st.clipPath}`)) return true;
      const r = c.getBoundingClientRect();
      if ((r.width <= 1 || r.height <= 1) && /(hidden|clip)/.test(st.overflow)) return true;
    }
    return false;
  };
  const decorativeOf = (e: Element): string | null => {
    if (e.closest('[role="img"],[role="presentation"],[role="none"]')) return 'role=img';
    for (let c: Element | null = e; c && c !== document.body; c = c.parentElement) {
      if (cs(c).pointerEvents === 'none' && !c.querySelector(FOCUSABLE) && c.getBoundingClientRect().width > 40)
        return 'pointer-events:none, no controls';
      // A whole interface shrunk to fit (transform: scale(0.5) on a box of dozens of elements)
      // is a picture of an app, however real its DOM.
      const m = /^matrix\(([-\d.e]+), ([-\d.e]+), ([-\d.e]+), ([-\d.e]+)/.exec(cs(c).transform);
      if (m) {
        const sx = Math.hypot(Number(m[1]), Number(m[2]));
        const sy = Math.hypot(Number(m[3]), Number(m[4]));
        if (sx < 0.8 && sy < 0.8 && c.getElementsByTagName('*').length >= 30)
          return `a whole interface scaled to ${Math.round(sx * 100)}%`;
      }
      if (/(^|[\s_-])(illustration|mockup|mock-up|artwork)/i.test(`${c.className}`)) return 'named an illustration';
    }
    return null;
  };
  // The same words twice, one over the other: a duplicated line for an effect (a gradient or
  // outline copy laid over the real heading), not two texts colliding.
  const sameWords = (x: string, y: string) => {
    const n = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
    const [p, q] = [n(x), n(y)];
    return p.length >= 6 && q.length >= 6 && (p.startsWith(q.slice(0, 12)) || q.startsWith(p.slice(0, 12)));
  };
  const blockOf = (e: Element) => e.closest('h1,h2,h3,h4,h5,h6,p,label,button,a,li,dt,dd,figcaption');
  // Any CSS colour a computed style can hold — rgb() with commas or spaces, but also oklch(),
  // lab(), color(display-p3 …) — as 8-bit sRGB. The modern spaces are drawn into a 1×1 canvas
  // and read back, so the browser itself does the conversion.
  const COLOR = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)|#[0-9a-f]{3,8}\b/i;
  const colorCache = new Map<string, { r: number; g: number; b: number; a: number } | null>();
  let pen: CanvasRenderingContext2D | null | undefined;
  const rgb = (c: string): { r: number; g: number; b: number; a: number } | null => {
    const tok = COLOR.exec(c)?.[0];
    if (!tok) return null;
    const fast = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(tok);
    if (fast) {
      const a = fast[4] === undefined ? 1 : Number(fast[4]) / (fast[5] ? 100 : 1);
      return { r: Number(fast[1]), g: Number(fast[2]), b: Number(fast[3]), a };
    }
    const hit = colorCache.get(tok);
    if (hit !== undefined) return hit;
    if (pen === undefined) {
      const cv = document.createElement('canvas');
      cv.width = 1;
      cv.height = 1;
      pen = cv.getContext('2d', { willReadFrequently: true });
    }
    let out: { r: number; g: number; b: number; a: number } | null = null;
    if (pen) {
      pen.clearRect(0, 0, 1, 1);
      pen.fillStyle = tok;
      pen.fillRect(0, 0, 1, 1);
      const d = pen.getImageData(0, 0, 1, 1).data;
      out = { r: d[0] ?? 0, g: d[1] ?? 0, b: d[2] ?? 0, a: (d[3] ?? 0) / 255 };
    }
    colorCache.set(tok, out);
    return out;
  };
  const hsl = (c: { r: number; g: number; b: number }) => {
    const r = c.r / 255,
      g = c.g / 255,
      b = c.b / 255;
    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b),
      l = (mx + mn) / 2,
      d = mx - mn;
    if (!d) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s, l };
  };

  const all = Array.from(document.body.querySelectorAll('*')).filter((e) => !ariaHidden(e));
  const leaves = all.filter((e) => ownText(e).length > 0 && shown(e) && !srOnly(e));

  // ── Overflow: only when the page itself scrolls sideways ───────────────────────────
  // A right-to-left page scrolls the other way: what lies past its LEFT edge is the overflow.
  const rtlPage = cs(document.documentElement).direction === 'rtl';
  // When a phone has zoomed out to fit (W < innerWidth), a right-to-left reader's screen is the
  // RIGHT-hand W pixels of the widened layout, so its left edge is at innerWidth − W.
  const leftEdge = Math.max(0, window.innerWidth - W);
  const past = (r: DOMRect) => (rtlPage ? r.left < leftEdge - 1 : r.right > W + 1);
  const scrollWidth = document.documentElement.scrollWidth;
  const overflow: AuditFacts['overflow'] = [];
  if (scrollWidth > W + 1) {
    const insideScroller = (e: Element) => {
      for (let c = e.parentElement; c && c !== document.body; c = c.parentElement) {
        if (/(hidden|auto|scroll|clip)/.test(cs(c).overflowX)) return true;
      }
      return false;
    };
    for (const e of all) {
      if (!shown(e)) continue;
      const r = e.getBoundingClientRect();
      if (!past(r)) continue;
      const p = e.parentElement;
      if (p && p !== document.body && past(p.getBoundingClientRect())) continue;
      if (insideScroller(e)) continue;
      // `right` is the far edge in the page's own direction: negative when past the left.
      overflow.push({
        sel: path(e),
        right: Math.round(rtlPage ? r.left : r.right),
        text: short(e.textContent ?? '', 40),
      });
      if (overflow.length >= 12) break;
    }
  }

  // ── Clipped text ──────────────────────────────────────────────────────────────────
  const clipped: AuditFacts['clipped'] = [];
  for (const e of all) {
    const s = cs(e);
    const hx = /(hidden|clip)/.test(s.overflowX);
    const hy = /(hidden|clip)/.test(s.overflowY);
    if (!hx && !hy) continue;
    if (s.textOverflow === 'ellipsis' || (s as unknown as Record<string, string>).webkitLineClamp !== 'none') continue;
    if (!shown(e) || e.clientHeight < 4 || e.clientWidth < 4) continue;
    const box = e.getBoundingClientRect();
    // Only text that is cut, not decoration: a text leaf inside it that crosses its edge.
    const cutX = hx && e.scrollWidth > e.clientWidth + 2;
    const cutY = hy && e.scrollHeight > e.clientHeight + 2;
    if (!cutX && !cutY) continue;
    // The TEXT's extent, not the element's: when the clipping box is the text element
    // itself, its own rectangle never crosses its own edge.
    const textRect = (t: Element) => {
      const range = document.createRange();
      range.selectNodeContents(t);
      return range.getBoundingClientRect();
    };
    // Right-to-left text overflows its box to the LEFT (that is the side scrollWidth counts).
    const rtl = s.direction === 'rtl';
    const overX = (r: DOMRect) => (rtl ? box.left - r.left : r.right - box.right);
    const victim = leaves.find((t) => {
      if (!e.contains(t)) return false;
      const r = textRect(t);
      return (
        (cutY && r.bottom > box.bottom + 2 && r.top < box.bottom) ||
        (cutX && overX(r) > 2 && (rtl ? r.right > box.left : r.left < box.right))
      );
    });
    if (!victim) continue;
    const r = textRect(victim);
    const axis = cutY && r.bottom > box.bottom + 2 ? 'y' : 'x';
    let ctx: Ctx | undefined;
    const why = decorativeOf(victim) ?? undefined;
    if (isHiddenNow(victim)) ctx = 'hidden';
    else if (why) ctx = 'decorative';
    else {
      // A marquee: the window's text repeats (the track is doubled to loop) or a part of it
      // animates forever, or its author named it one.
      const said = leaves.filter((t) => e.contains(t)).map(ownText);
      // A loop is drawn twice so it can scroll seamlessly: its opening words come round again.
      const all = (e.textContent ?? '').replace(/\s+/g, ' ').trim();
      const head = all.slice(0, Math.min(24, Math.floor(all.length / 3)));
      const doubled = head.length >= 8 && all.indexOf(head, head.length) > 0;
      const loops = Array.from(e.querySelectorAll('*')).some(
        (k) => cs(k).animationIterationCount === 'infinite' && cs(k).animationName !== 'none',
      );
      if (doubled || new Set(said).size < said.length * 0.75 || loops || /marquee|ticker/i.test(`${e.className}`))
        ctx = 'marquee';
    }
    clipped.push({
      sel: path(e),
      text: short(ownText(victim), 40),
      ...(ctx ? { ctx } : {}),
      ...(why ? { why } : {}),
      axis,
      ...(axis === 'x' && rtl ? { side: 'left' as const } : {}),
      by: Math.round(axis === 'y' ? r.bottom - box.bottom : overX(r)),
    });
    if (clipped.length >= 12) break;
  }

  // ── Text drawn on text, and text covered in the first screen ──────────────────────
  const solid = leaves.filter((e) => opacityOf(e) > 0.5).slice(0, 700);
  // The GLYPHS' boxes, line by line, not the element's: a corner badge over the empty end of a
  // full-width heading covers no words.
  const glyphs = (e: Element): DOMRect[] => {
    const out: DOMRect[] = [];
    for (const n of Array.from(e.childNodes)) {
      if (n.nodeType !== 3 || !(n.textContent ?? '').trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) if (r.width > 0 && r.height > 0) out.push(r);
      if (out.length > 40) break;
    }
    return out;
  };
  const rects = solid.map(glyphs);
  const sy0 = window.scrollY;
  const overlaps: AuditFacts['overlaps'] = [];
  // Where two texts first meet (the centre of the shared area), or null when they do not.
  const collide = (P: DOMRect[], Q: DOMRect[]): { x: number; y: number } | null => {
    for (const A of P)
      for (const B of Q) {
        const l = Math.max(A.left, B.left);
        const t = Math.max(A.top, B.top);
        const w = Math.min(A.right, B.right) - l;
        const h = Math.min(A.bottom, B.bottom) - t;
        if (w <= 0 || h <= 0) continue;
        const small = Math.min(A.width * A.height, B.width * B.height);
        if (w * h >= 0.25 * small && w * h >= 40) return { x: l + w / 2, y: t + h / 2 };
      }
    return null;
  };
  for (let i = 0; i < solid.length && overlaps.length < 12; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i] as Element,
        b = solid[j] as Element;
      if (a.contains(b) || b.contains(a)) continue;
      const at = collide(rects[i] as DOMRect[], rects[j] as DOMRect[]);
      if (!at) continue;
      let ctx: Ctx | undefined;
      const why = decorativeOf(a) ?? decorativeOf(b) ?? undefined;
      if (isHiddenNow(a) || isHiddenNow(b)) ctx = 'hidden';
      else if (why) ctx = 'decorative';
      else if ((blockOf(a) && blockOf(a) === blockOf(b)) || sameWords(ownText(a), ownText(b))) ctx = 'layered';
      else {
        // What is PAINTED where they meet: an opaque layer above the lower text, belonging to
        // the upper one's side, means the lower is occluded, not drawn over. elementsFromPoint
        // sees only the screen, so the point is scrolled into view first (and put back after).
        const docY = at.y + window.scrollY;
        if (at.y < 0 || at.y >= window.innerHeight) window.scrollTo(0, Math.max(0, docY - window.innerHeight / 2));
        const stack = document.elementsFromPoint(at.x, docY - window.scrollY);
        window.scrollTo(0, sy0);
        const ia = stack.findIndex((x) => x === a || a.contains(x));
        const ib = stack.findIndex((x) => x === b || b.contains(x));
        const [top, low, il] = ia !== -1 && (ib === -1 || ia < ib) ? [a, b, ib] : [b, a, ia];
        const between = il === -1 ? stack : stack.slice(0, il);
        if (
          between.some((x) => {
            // The upper text's own box counts: its background is what hides the lower one.
            if (x.contains(low) || (top.contains(x) && x !== top)) return false;
            const bg = rgb(cs(x).backgroundColor);
            return (bg && bg.a > 0.9) || x.tagName === 'IMG';
          })
        )
          ctx = 'stacked';
      }
      overlaps.push({
        a: path(a),
        b: path(b),
        text: short(ownText(a), 30),
        other: short(ownText(b), 30),
        ...(ctx ? { ctx } : {}),
        ...(why ? { why } : {}),
      });
      break;
    }
  }
  const covered: AuditFacts['covered'] = [];
  for (const e of solid) {
    const r = e.getBoundingClientRect();
    const x = r.left + r.width / 2,
      y = r.top + Math.min(r.height / 2, 10);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const hit = document.elementFromPoint(x, y);
    if (!hit || hit === e || e.contains(hit) || hit.contains(e)) continue;
    // A label's own wrapper (a link around a span) is the same control.
    if (hit.closest('a,button,label') && hit.closest('a,button,label') === e.closest('a,button,label')) continue;
    if (
      cs(hit).position !== 'fixed' &&
      cs(hit).position !== 'sticky' &&
      cs(hit).position !== 'absolute' &&
      !hit.closest('[style*="z-index"]')
    ) {
      if (hit.getBoundingClientRect().width * hit.getBoundingClientRect().height < r.width * r.height) continue;
    }
    let ctx: Ctx | undefined;
    const control = hit.closest('input,textarea,select') ?? hit.querySelector?.('input,textarea,select');
    if ((blockOf(e) && blockOf(e) === blockOf(hit)) || sameWords(ownText(e), hit.textContent ?? '')) ctx = 'layered';
    else if (
      control &&
      (e.closest('label') ||
        (e.parentElement && (e.parentElement.contains(control) || e.parentElement.parentElement?.contains(control))))
    )
      ctx = 'label';
    else if (decorativeOf(e)) ctx = 'decorative';
    else {
      // A deck: the covering item and the covered one are siblings of one list of repeated
      // items (same tag and class under one parent), layered in place, not pinned to the
      // screen. A fixed or sticky layer over text (a banner) stays a fault.
      const item = (x: Element) => {
        for (let c: Element | null = x; c?.parentElement; c = c.parentElement) {
          const p = c.parentElement as Element;
          const twins = Array.from(p.children).filter((k) => k.tagName === c?.tagName && k.className === c?.className);
          if (twins.length >= 2 && c.contains(x)) return c;
          if (c.contains(hit) && c.contains(e)) return null;
        }
        return null;
      };
      const ie = item(e);
      const ih = item(hit);
      const pinned = (x: Element) => {
        for (let c: Element | null = x; c; c = c.parentElement) if (/fixed|sticky/.test(cs(c).position)) return true;
        return false;
      };
      if (ie && ih && ie !== ih && ie.parentElement === ih.parentElement && !pinned(hit)) ctx = 'stacked';
    }
    covered.push({ sel: path(e), text: short(ownText(e), 30), by: path(hit), ...(ctx ? { ctx } : {}) });
    if (covered.length >= 8) break;
  }

  // ── Broken images, invisible content ──────────────────────────────────────────────
  const brokenImages = Array.from(document.images)
    .filter((i) => i.getAttribute('src') && i.complete && i.naturalWidth === 0 && !ariaHidden(i))
    .slice(0, 12)
    .map((i) => ({ sel: path(i), src: (i.getAttribute('src') ?? '').slice(0, 120) }));
  const invisible = all
    .filter((e) => ownText(e).length > 2 && cs(e).display !== 'none' && cs(e).visibility === 'visible')
    .filter((e) => {
      const r = e.getBoundingClientRect();
      // Inert content (a slide not showing, a closed drawer) is hidden by the page's own
      // declaration, not waiting on a script that may never run.
      return r.width > 4 && r.height > 4 && opacityOf(e) < 0.05 && !e.closest('[inert]');
    })
    .slice(0, 50)
    .map((e) => ({ sel: path(e), text: short(ownText(e), 40) }));

  // ── Reading ───────────────────────────────────────────────────────────────────────
  const paragraphs: AuditFacts['paragraphs'] = [];
  for (const e of leaves) {
    if (!/^(P|LI|DD|BLOCKQUOTE)$/.test(e.tagName) && !(e.tagName === 'DIV' && ownText(e).length > 120)) continue;
    const s = cs(e);
    const fs = Number.parseFloat(s.fontSize);
    const lh = s.lineHeight === 'normal' ? fs * 1.2 : Number.parseFloat(s.lineHeight);
    const r = e.getBoundingClientRect();
    const lines = Math.max(1, Math.round(r.height / lh));
    const text = e.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    paragraphs.push({
      sel: path(e),
      cpl: Math.round(text.length / lines),
      lines,
      lineHeight: Math.round((lh / fs) * 100) / 100,
      fontSize: fs,
      centred: s.textAlign === 'center',
    });
  }
  const targets: AuditFacts['targets'] = [];
  const TARGET =
    'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab],[role=checkbox]';
  const proseAround = (p: Element) => {
    let n = 0;
    const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const ctl = t.parentElement?.closest(`${TARGET},label`);
      if (ctl && ctl !== p && p.contains(ctl)) continue;
      n += (t.textContent ?? '').replace(/\s+/g, ' ').trim().length;
    }
    return n;
  };
  const small: { e: Element; r: DOMRect }[] = [];
  const pictures: NonNullable<AuditFacts['pictures']> = [];
  for (const e of all) {
    if (!e.matches(TARGET)) continue;
    // Not on screen now (opacity 0, inert): nobody can aim at it, so its size is not a fault.
    if (!shown(e) || isHiddenNow(e)) continue;
    // A control inside a picture of UI is not a target anyone should aim at; that a keyboard
    // can reach it at all is the fault, reported once per picture.
    const pic = decorativeOf(e);
    if (pic) {
      let root: Element = e;
      for (let c = e.parentElement; c && c !== document.body && decorativeOf(c); c = c.parentElement) root = c;
      const key = path(root);
      const had = pictures.find((x) => x.sel === key);
      if (had) had.controls++;
      else if (pictures.length < 6) pictures.push({ sel: key, why: pic, controls: 1 });
      continue;
    }
    // A link inside running text is exempt (WCAG 2.5.8 "inline"). Running text is the
    // parent's OWN words: a row of links has none, however much link text it holds.
    if (e.tagName === 'A' && cs(e).display === 'inline' && e.parentElement && proseAround(e.parentElement) > 20)
      continue;
    const r = e.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) small.push({ e, r });
  }
  // WCAG 2.5.8's spacing exception: an undersized target passes when a 24px circle on its
  // centre meets no other target (nor another such circle).
  const allTargets = all
    .filter((e) => e.matches(TARGET) && shown(e))
    .slice(0, 800)
    .map((e) => ({ e, r: e.getBoundingClientRect() }));
  for (const { e, r } of small) {
    const cx = r.left + r.width / 2,
      cy = r.top + r.height / 2;
    const crowded = allTargets.some(({ e: o, r: q }) => {
      if (o === e || o.contains(e) || e.contains(o)) return false;
      const isSmall = q.width < 24 || q.height < 24;
      if (isSmall && Math.hypot(q.left + q.width / 2 - cx, q.top + q.height / 2 - cy) < 24) return true;
      // Distance from the centre to the other target's box.
      const dx = Math.max(q.left - cx, 0, cx - q.right),
        dy = Math.max(q.top - cy, 0, cy - q.bottom);
      return Math.hypot(dx, dy) < 12;
    });
    targets.push({
      sel: path(e),
      text: short(e.textContent || e.getAttribute('aria-label') || '', 30),
      w: Math.round(r.width),
      h: Math.round(r.height),
      ...(crowded ? {} : { spaced: true }),
    });
    if (targets.length >= 20) break;
  }
  // innerText, not textContent: an accessible name is what is RENDERED (hidden text excluded).
  const nameOf = (e: Element) =>
    (
      e.getAttribute('aria-label') ||
      // biome-ignore lint/performance/useDomNodeTextContent: the RENDERED text is the accessible name; hidden text must not count
      (e as HTMLElement).innerText ||
      (e as HTMLInputElement).value ||
      e.getAttribute('title') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
  const controls: AuditFacts['controls'] = all
    .filter((e) => e.matches('a[href],button,input[type=submit],input[type=button],[role=button],[role=link]'))
    .slice(0, 600)
    .map((e) => {
      const role: 'link' | 'button' = e.matches('a[href],[role=link]') ? 'link' : 'button';
      // A hidden control has no rendered text; its DOM text is still its name.
      const name = (nameOf(e) || (e.textContent ?? '').replace(/\s+/g, ' ').trim()).slice(0, 80);
      const c: AuditFacts['controls'][number] = { sel: path(e), role, name, visible: shown(e) };
      const href = e.getAttribute('href');
      if (href) c.href = href;
      return c;
    });
  /*
   * Menus, for the navigation's LOGIC (not its looks): each navigation landmark outside the
   * footer, its entries with where they go and whether one is marked as this page, and the
   * longest run of sibling entries (one strip of the menu). Footers repeat the site's links on
   * purpose and are left out.
   */
  const navs: NonNullable<AuditFacts['navs']> = all
    .filter(
      (e) =>
        (e.tagName === 'NAV' || e.getAttribute('role') === 'navigation') && !e.closest('footer,[role=contentinfo]'),
    )
    .slice(0, 12)
    .map((nav) => {
      const links = Array.from(nav.querySelectorAll('a[href],[role=link],button,[role=tab],[role=menuitem]')).filter(
        (e) => e.closest('nav,[role=navigation]') === nav,
      );
      const entries = links.slice(0, 80).map((e) => {
        const text = (nameOf(e) || (e.textContent ?? '')).replace(/\s+/g, ' ').trim().slice(0, 60);
        const entry: NonNullable<AuditFacts['navs']>[number]['entries'][number] = {
          sel: path(e),
          name: text,
          visible: shown(e),
        };
        const href = e.getAttribute('href');
        if (href) entry.href = href;
        const cur = e.getAttribute('aria-current');
        if ((cur && cur !== 'false') || e.getAttribute('aria-selected') === 'true') entry.current = true;
        // A logo: an image (or svg) and no words of its own. Its name is the site's, not a page's.
        if (e.querySelector('img,svg') && !(e.textContent ?? '').trim()) entry.logo = true;
        return entry;
      });
      // The widest strip: the most entries sharing one parent list (li siblings, or direct children).
      let strip = 0;
      for (const list of Array.from(nav.querySelectorAll('ul,ol,[role=menubar],[role=tablist]'))) {
        if (list.closest('nav,[role=navigation]') !== nav) continue;
        const items = Array.from(list.children).filter(
          (c) => shown(c) && c.querySelector('a[href],button,[role=link],[role=tab],[role=menuitem]'),
        );
        strip = Math.max(strip, items.length);
      }
      if (!strip) strip = entries.filter((x) => x.visible).length;
      return { sel: path(nav), label: (nav.getAttribute('aria-label') ?? '').trim().slice(0, 60), entries, strip };
    });
  /*
   * Links that go nowhere: `#`, an empty href, `javascript:`, or `#id` with no such id on the
   * page. A control that looks like a way forward and is not one; slop-detect and Hallmark both
   * check it. Hidden ones count too: a menu that opens later opens onto them.
   */
  const deadLinks: NonNullable<AuditFacts['deadLinks']> = [];
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const href = (a.getAttribute('href') ?? '').trim();
    const name = (nameOf(a) || (a.textContent ?? '')).replace(/\s+/g, ' ').trim().slice(0, 50);
    let dead = href === '' || href === '#' || /^javascript:/i.test(href);
    if (!dead && /^#[^/!]/.test(href)) {
      const id = decodeURIComponent(href.slice(1));
      dead = !document.getElementById(id) && !document.getElementsByName(id).length;
    }
    if (dead && deadLinks.length < 20) deadLinks.push({ sel: path(a), name, href });
  }
  /*
   * The page's own values, counted: with no design to compare against, the page is its own
   * reference, and a value used once beside a near-copy used everywhere is the agent's slip.
   * Colours of text, fills and borders; font sizes of text; radii of boxes; and how each
   * filled button is drawn.
   */
  const tally = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const hex = (c: { r: number; g: number; b: number }) =>
    `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  const colorUse = new Map<string, number>();
  const sizeUse = new Map<string, number>();
  const radiusUse = new Map<string, number>();
  const buttons: NonNullable<AuditFacts['palette']>['buttons'] = [];
  for (const e of all) {
    if (!shown(e) || ariaHidden(e)) continue;
    const s = cs(e);
    const own = Array.from(e.childNodes).some((n) => n.nodeType === 3 && /\S/.test(n.textContent ?? ''));
    if (own) {
      const c = rgb(s.color);
      if (c && c.a > 0.5) tally(colorUse, hex(c));
      tally(sizeUse, String(Math.round(Number.parseFloat(s.fontSize) * 2) / 2));
    }
    const bg = rgb(s.backgroundColor);
    if (bg && bg.a > 0.5) tally(colorUse, hex(bg));
    const bw = Number.parseFloat(s.borderTopWidth) || 0;
    const bc = rgb(s.borderTopColor);
    if (bw >= 1 && bc && bc.a > 0.5) tally(colorUse, hex(bc));
    const rad = Number.parseFloat(s.borderTopLeftRadius) || 0;
    const r = e.getBoundingClientRect();
    if (rad > 0 && rad < r.height / 2 - 1 && ((bg && bg.a > 0.05) || bw >= 1))
      tally(radiusUse, String(Math.round(rad)));
    // A skip link waits off screen until it is focused: its shape is not a button style.
    const offscreen = r.right <= 0 || r.bottom + window.scrollY <= 0 || /^skip\b/i.test((e.textContent ?? '').trim());
    if (
      e.matches('button,a[href],[role=button],input[type=submit]') &&
      !offscreen &&
      bg &&
      bg.a > 0.5 &&
      r.height >= 24 &&
      buttons.length < 60
    )
      buttons.push({
        sel: path(e),
        text: (nameOf(e) || (e.textContent ?? '')).replace(/\s+/g, ' ').trim().slice(0, 30),
        radius: Math.round(rad >= r.height / 2 - 1 ? 999 : rad),
        height: Math.round(r.height),
        fontSize: Number.parseFloat(s.fontSize) || 0,
        fontWeight: Number.parseInt(s.fontWeight, 10) || 400,
      });
  }
  const sorted = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 60);
  const palette: NonNullable<AuditFacts['palette']> = {
    colors: sorted(colorUse),
    sizes: sorted(sizeUse).map(([k, n]) => [Number(k), n] as [number, number]),
    radii: sorted(radiusUse).map(([k, n]) => [Number(k), n] as [number, number]),
    buttons,
  };
  const docMeta = {
    viewportMeta: !!document.querySelector('meta[name="viewport"]'),
    title: document.title.trim().slice(0, 120),
    description: (document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '')
      .trim()
      .slice(0, 200),
  };
  const labelOf = (el: Element) => {
    const id = el.getAttribute('id');
    const lab = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest('label');
    return (el.getAttribute('aria-label') || lab?.textContent || el.getAttribute('placeholder') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
  };
  /*
   * Each visible form's layout, for form design (core/form-design.ts): every field's box, its
   * font size, what its markup says it holds, and its label's box. Pictures of UI and fields not
   * on screen (a closed group) are left out.
   */
  const formLayouts: NonNullable<AuditFacts['formLayouts']> = [];
  for (const form of Array.from(document.forms).slice(0, 20)) {
    if (!shown(form) || decorativeOf(form)) continue;
    const fr = form.getBoundingClientRect();
    const fields: NonNullable<AuditFacts['formLayouts']>[number]['fields'] = [];
    for (const el of Array.from(form.elements)) {
      if (!el.matches('input,select,textarea') || fields.length >= 120) continue;
      const inp = el as HTMLInputElement;
      if (/^(hidden|submit|button|reset|image|checkbox|radio|file|color|range)$/.test(inp.type)) continue;
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      const lab = (inp.labels?.[0] as HTMLElement | undefined) ?? null;
      // The label's TEXT box, not the <label>: a label that wraps its field is as tall as both.
      const textOf = (l: HTMLElement) => {
        const span = Array.from(l.querySelectorAll('span,strong,b')).find((x) => (x.textContent ?? '').trim()) as
          | HTMLElement
          | undefined;
        return span && !span.contains(el) ? span : l.contains(el) ? null : l;
      };
      const lt = lab ? textOf(lab) : null;
      const lr = lt?.getBoundingClientRect();
      fields.push({
        sel: path(el),
        x: r.left + window.scrollX,
        y: r.top + window.scrollY,
        w: r.width,
        h: r.height,
        font: Number.parseFloat(cs(el).fontSize) || 16,
        type: el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : inp.type,
        ...(inp.maxLength > 0 ? { maxlength: inp.maxLength } : {}),
        ...(inp.getAttribute('max') ? { max: inp.getAttribute('max') as string } : {}),
        ...(inp.getAttribute('step') ? { step: inp.getAttribute('step') as string } : {}),
        ...(el.tagName === 'INPUT' && inp.value ? { value: inp.value.slice(0, 40) } : {}),
        ...(inp.getAttribute('autocomplete') ? { autocomplete: inp.getAttribute('autocomplete') as string } : {}),
        ...(el.tagName === 'SELECT'
          ? {
              options: Array.from((el as HTMLSelectElement).options)
                .slice(0, 40)
                .map((o) => o.text.trim()),
            }
          : {}),
        ...(lt && lr && lr.width > 0
          ? {
              label: {
                text: short(lt.textContent ?? '', 60),
                x: lr.left + window.scrollX,
                y: lr.top + window.scrollY,
                w: lr.width,
                h: lr.height,
              },
            }
          : {}),
      });
    }
    if (fields.length) formLayouts.push({ sel: path(form), width: fr.width, fields });
  }
  const forms: AuditFacts['forms'] = Array.from(document.forms)
    .slice(0, 30)
    .map((form) => ({
      sel: path(form),
      action: form.getAttribute('action') ?? '',
      method: (form.getAttribute('method') || 'get').toLowerCase(),
      fields: Array.from(form.elements)
        .filter(
          (el) =>
            el.matches('input,select,textarea') && !/^(submit|button|reset|image)$/.test((el as HTMLInputElement).type),
        )
        .map((el) => ({
          name: el.getAttribute('name') ?? '',
          type: el.tagName === 'INPUT' ? (el as HTMLInputElement).type || 'text' : el.tagName.toLowerCase(),
          required: (el as HTMLInputElement).required,
          label: labelOf(el),
        })),
      submits: Array.from(form.querySelectorAll('button:not([type=button]):not([type=reset]),input[type=submit]')).map(
        (b) => nameOf(b) || (b.textContent ?? '').trim(),
      ),
    }));
  // Header and footer are landmarks only at the top level, not inside an article or section.
  const LANDMARK: Record<string, string> = {
    NAV: 'navigation',
    MAIN: 'main',
    ASIDE: 'complementary',
    SEARCH: 'search',
  };
  const landmarkOf = (e: Element): string => {
    const role = e.getAttribute('role');
    if (role) return role;
    if (e.tagName === 'HEADER' || e.tagName === 'FOOTER')
      return e.closest('article,aside,main,nav,section') ? '' : e.tagName === 'HEADER' ? 'banner' : 'contentinfo';
    return LANDMARK[e.tagName] ?? '';
  };
  const landmarks = [
    ...new Set(
      all
        .map(landmarkOf)
        .filter((r) => /^(banner|navigation|main|contentinfo|complementary|search|form|region)$/.test(r)),
    ),
  ].sort();
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    .filter((e) => shown(e) && !ariaHidden(e))
    .slice(0, 200)
    .map((e) => ({
      sel: path(e),
      level: Number(e.tagName[1]),
      text: (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
      // A heading inside a picture of UI is part of the picture: no size, so the hierarchy
      // check leaves it out.
      ...(decorativeOf(e) ? {} : { size: Math.round(Number.parseFloat(cs(e).fontSize) * 2) / 2 }),
    }));
  /*
   * The page's own system, for design sense (core/design-sense.ts): every padding, margin and
   * gap it sets (with how often, and one element that sets it), and the left edge of every
   * block of text (where its columns are). Pictures of UI are left out: their spacing is a
   * screenshot's.
   */
  const UA_MARGIN_EM: Record<string, number> = {
    H1: 0.67,
    H2: 0.83,
    H3: 1,
    H4: 1.33,
    H5: 1.67,
    H6: 2.33,
    P: 1,
    UL: 1,
    OL: 1,
    DL: 1,
    BLOCKQUOTE: 1,
    FIGURE: 1,
    PRE: 1,
  };
  const spaceUse = new Map<number, { n: number; sel: string }>();
  const edges: { x: number; y: number; h: number; sel: string }[] = [];
  for (const e of all) {
    if (!shown(e) || decorativeOf(e)) continue;
    const st = cs(e);
    // The browser's own default margins (h1 0.67em, p 1em…) are nobody's choice.
    const fs = Number.parseFloat(st.fontSize) || 16;
    const uaEm = UA_MARGIN_EM[e.tagName];
    // Counted per element, not per side: padding:13px is one decision, not four.
    const mine = new Set<number>();
    for (const [v, isMargin] of [
      [st.paddingTop, false],
      [st.paddingRight, false],
      [st.paddingBottom, false],
      [st.paddingLeft, false],
      [st.marginTop, true],
      [st.marginBottom, true],
      [st.rowGap, false],
      [st.columnGap, false],
    ] as [string, boolean][]) {
      const n = Math.round(Number.parseFloat(v) * 2) / 2;
      if (!(n > 2) || n > 256) continue;
      if (isMargin && uaEm !== undefined && Math.abs(n - uaEm * fs) <= 0.6) continue;
      if (mine.has(n)) continue;
      mine.add(n);
      const had = spaceUse.get(n);
      if (had) had.n++;
      else spaceUse.set(n, { n: 1, sel: path(e) });
    }
    if (
      edges.length < 600 &&
      ownText(e).length > 2 &&
      !srOnly(e) &&
      !/^inline/.test(st.display) &&
      /^(left|start|justify)$/.test(st.textAlign)
    ) {
      const r = e.getBoundingClientRect();
      edges.push({ x: r.left, y: r.top + window.scrollY, h: r.height, sel: path(e) });
    }
  }
  const spacing = [...spaceUse].map(([v, u]) => [v, u.n, u.sel] as [number, number, string]);
  const fontSizes = [...new Set(leaves.map((e) => Math.round(Number.parseFloat(cs(e).fontSize) * 2) / 2))].sort(
    (a, b) => a - b,
  );
  const texts = leaves.slice(0, 1500).map((e) => ({ sel: path(e), text: ownText(e).slice(0, 300) }));
  const imageSrcs = [
    ...Array.from(document.images).map((i) => i.currentSrc || i.src),
    ...all.map((e) => /url\("?([^")]+)"?\)/.exec(cs(e).backgroundImage)?.[1] ?? '').filter(Boolean),
  ].slice(0, 200);

  // ── Contrast (WCAG 1.4.3) ─────────────────────────────────────────────────────────
  // What is DRAWN: the text colour over every background behind it, composited as the browser
  // does — alpha, and each element's opacity applying to its whole group (text and background
  // alike). Anything that is not one flat colour behind the words — an image, a gradient, a
  // video, a filter or blend, an overlay pseudo-element, another box drawn across them — makes
  // the text UNKNOWN: counted, never judged, never a pass.
  type P = [number, number, number, number]; // premultiplied r, g, b (0–255) and alpha (0–1)
  const pm = (c: { r: number; g: number; b: number; a: number }): P => [c.r * c.a, c.g * c.a, c.b * c.a, c.a];
  const over = (t: P, u: P): P => [
    t[0] + u[0] * (1 - t[3]),
    t[1] + u[1] * (1 - t[3]),
    t[2] + u[2] * (1 - t[3]),
    t[3] + u[3] * (1 - t[3]),
  ];
  const fade = (p: P, o: number): P => [p[0] * o, p[1] * o, p[2] * o, p[3] * o];
  const flat = (p: P): [number, number, number] => [
    Math.round(p[0] * 100) / 100,
    Math.round(p[1] * 100) / 100,
    Math.round(p[2] * 100) / 100,
  ];
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="color-scheme"]')?.getAttribute('content') ?? '';
  const declared = cs(root).colorScheme && cs(root).colorScheme !== 'normal' ? cs(root).colorScheme : meta;
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const darkCanvas = /dark/.test(declared) && (!/light/.test(declared) || prefersDark);
  const CANVAS: P = darkCanvas ? [18, 18, 18, 1] : [255, 255, 255, 1];
  const rootBg = rgb(cs(root).backgroundColor);
  const bodyIsCanvas = (!rootBg || rootBg.a === 0) && cs(root).backgroundImage === 'none';
  const MEDIA = /^(IMG|VIDEO|CANVAS|SVG|PICTURE|IFRAME|OBJECT|EMBED)$/i;
  // Boxes that paint something, from the whole document (decorative overlays are often aria-hidden).
  const painters: { e: Element; r: DOMRect }[] = [];
  for (const p of Array.from(document.body.querySelectorAll('*'))) {
    if (painters.length >= 3000) break;
    const s = cs(p);
    if (s.display === 'none' || s.visibility !== 'visible') continue;
    const bg = rgb(s.backgroundColor);
    if (!MEDIA.test(p.tagName) && s.backgroundImage === 'none' && !(bg && bg.a > 0.02)) continue;
    const r = p.getBoundingClientRect();
    if (r.width > 1 && r.height > 1) painters.push({ e: p, r });
  }
  const painted = (s: CSSStyleDeclaration) => {
    if (s.content === 'none' || s.content === 'normal') return false;
    const bg = rgb(s.backgroundColor);
    return s.backgroundImage !== 'none' || (!!bg && bg.a > 0.02);
  };
  /** The colour behind (and of) text at a point, or why it cannot be one colour. */
  const drawn = (e: Element, fg: P, x: number, y: number) => {
    let withText = fg;
    let without: P = [0, 0, 0, 0];
    for (let c: Element | null = e; c; c = c.parentElement) {
      const s = cs(c) as CSSStyleDeclaration & { webkitBackdropFilter?: string };
      if (s.filter !== 'none') return { why: 'a filter' };
      if (s.mixBlendMode !== 'normal') return { why: 'a blend mode' };
      const canvasWide = c === root || (c === document.body && bodyIsCanvas);
      const r = c.getBoundingClientRect();
      const under = canvasWide || (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
      const seeThrough = without[3] < 0.999;
      if (under && seeThrough) {
        if (s.backgroundImage !== 'none') return { why: 'a background image or gradient' };
        if (MEDIA.test(c.tagName)) return { why: 'an image or video' };
        const bf = `${s.backdropFilter ?? 'none'} ${s.webkitBackdropFilter ?? ''}`.replace(/none|blur\([^)]*\)/g, '');
        if (bf.trim()) return { why: 'a backdrop filter' };
        for (const pseudo of ['::before', '::after']) {
          const ps = getComputedStyle(c, pseudo);
          if (painted(ps) && /absolute|fixed/.test(ps.position)) return { why: 'an overlay pseudo-element' };
        }
      }
      const bg = under ? rgb(s.backgroundColor) : null;
      if (bg && bg.a > 0) {
        withText = over(withText, pm(bg));
        without = over(without, pm(bg));
      }
      const o = Number.parseFloat(s.opacity || '1');
      if (o < 1) {
        withText = fade(withText, o);
        without = fade(without, o);
      }
    }
    return { fg: flat(over(withText, CANVAS)), bg: flat(over(without, CANVAS)) };
  };
  const textColors: NonNullable<AuditFacts['textColors']> = [];
  let unknownN = 0;
  let unknownSel: string | undefined;
  let unknownWhy: string | undefined;
  const unknown = (e: Element, why: string) => {
    unknownN++;
    if (!unknownSel) {
      unknownSel = path(e);
      unknownWhy = why;
    }
  };
  for (const e of leaves) {
    if (textColors.length >= 1500) break;
    // Exempt by WCAG 1.4.3: inactive controls, logotypes, and text nobody can see (reported as hidden).
    if (e.closest(':disabled,[aria-disabled="true"]')) continue;
    if ((e.closest('label') as HTMLLabelElement | null)?.control?.matches(':disabled')) continue;
    if (e.closest('[class*="logo" i],[id*="logo" i],[class*="brand" i]')) continue;
    if (e.closest('select,textarea,option')) continue;
    if (opacityOf(e) < 0.05) continue;
    if (e.closest('svg')) {
      unknown(e, 'SVG text');
      continue;
    }
    const s = cs(e) as CSSStyleDeclaration & { webkitTextFillColor?: string; webkitBackgroundClip?: string };
    const fill = rgb(s.webkitTextFillColor || s.color) ?? rgb(s.color);
    if (!fill || fill.a === 0 || /text/.test(`${s.backgroundClip} ${s.webkitBackgroundClip ?? ''}`)) {
      unknown(e, 'transparent or clipped text');
      continue;
    }
    const boxes = glyphs(e);
    const first = boxes[0];
    if (!first) continue;
    // Anything else drawn across the words: a hero image behind them, a positioned blob.
    const across = painters.find(
      ({ e: p, r }) =>
        !p.contains(e) &&
        !e.contains(p) &&
        boxes.some(
          (b) =>
            Math.min(b.right, r.right) - Math.max(b.left, r.left) > 2 &&
            Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top) > 2,
        ),
    );
    if (across) {
      unknown(e, `${path(across.e)} is drawn across it`);
      continue;
    }
    // Sample where the words are SEEN: text cut off by an overflow-clipping ancestor is
    // measured on its visible part, not on the page behind the part that was hidden.
    let [vl, vt, vr, vb] = [first.left, first.top, first.right, first.bottom];
    for (let c: Element | null = e; c && c !== root; c = c.parentElement) {
      const cc = cs(c);
      if (cc.overflowX === 'visible' && cc.overflowY === 'visible') continue;
      const r = c.getBoundingClientRect();
      if (cc.overflowX !== 'visible') [vl, vr] = [Math.max(vl, r.left), Math.min(vr, r.right)];
      if (cc.overflowY !== 'visible') [vt, vb] = [Math.max(vt, r.top), Math.min(vb, r.bottom)];
    }
    if (vr - vl < 1 || vb - vt < 1) continue;
    const d = drawn(e, pm(fill), (vl + vr) / 2, (vt + vb) / 2);
    if (!d.fg || !d.bg) {
      unknown(e, d.why ?? 'unresolved');
      continue;
    }
    const stroke = Number.parseFloat((s as unknown as Record<string, string>).webkitTextStrokeWidth ?? '0') || 0;
    textColors.push({
      sel: path(e),
      text: short(ownText(e), 40),
      fg: d.fg,
      bg: d.bg,
      size: Number.parseFloat(s.fontSize),
      weight: Number.parseFloat(s.fontWeight) || 400,
      ...(s.textShadow !== 'none' || stroke > 0 ? { shadow: true } : {}),
    });
  }
  const contrastUnknown: AuditFacts['contrastUnknown'] = {
    n: unknownN,
    ...(unknownSel ? { sel: unknownSel } : {}),
    ...(unknownWhy ? { why: unknownWhy } : {}),
  };

  // A dark theme whose root never said so: the browser keeps native controls light. A control
  // that follows a color-scheme (its own or the root's) gets a dark field colour: not counted.
  let lightControls: AuditFacts['lightControls'];
  if (prefersDark) {
    let darkRules = false;
    const scan = (rules: CSSRuleList, depth: number): void => {
      for (const rule of Array.from(rules)) {
        if (darkRules || depth > 4) return;
        const cond = (rule as CSSMediaRule).conditionText ?? (rule as CSSMediaRule).media?.mediaText ?? '';
        if (/prefers-color-scheme\s*:\s*dark/.test(cond)) darkRules = true;
        else if ((rule as CSSGroupingRule).cssRules) scan((rule as CSSGroupingRule).cssRules, depth + 1);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      if (/prefers-color-scheme\s*:\s*dark/.test(sheet.media?.mediaText ?? '')) darkRules = true;
      try {
        if (!darkRules) scan(sheet.cssRules, 0);
      } catch {
        /* a cross-origin sheet cannot be read */
      }
      if (darkRules) break;
    }
    if (darkRules) {
      const lum = (p: [number, number, number]) => (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
      const light = Array.from(
        document.body.querySelectorAll(
          'input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea,button',
        ),
      ).filter((c) => {
        if (!shown(c) || ariaHidden(c)) return false;
        const own = rgb(cs(c).backgroundColor);
        if (!own || own.a < 0.5 || lum([own.r, own.g, own.b]) < 0.6) return false;
        const r = c.getBoundingClientRect();
        const p = c.parentElement;
        const d = p ? drawn(p, [0, 0, 0, 0], r.left + r.width / 2, r.top + r.height / 2) : null;
        return !!d?.bg && lum(d.bg) < 0.25;
      });
      if (light[0]) lightControls = { n: light.length, sel: path(light[0]) };
    }
  }

  // ── The tells ─────────────────────────────────────────────────────────────────────
  const isCard = (e: Element) => {
    const s = cs(e);
    const radius = Number.parseFloat(s.borderTopLeftRadius) || 0;
    if (radius < 6) return false;
    const bg = rgb(s.backgroundColor);
    const hasBg = !!bg && bg.a > 0.05;
    const hasBorder = Number.parseFloat(s.borderTopWidth) > 0 && Number.parseFloat(s.borderBottomWidth) > 0;
    const hasShadow = s.boxShadow !== 'none';
    const r = e.getBoundingClientRect();
    return (hasBg || hasBorder || hasShadow) && r.width >= 120 && r.height >= 60;
  };
  const cards = all.filter((e) => shown(e) && isCard(e));
  // A table's rows drawn as cards on a phone (a stacked table) are data, not decoration.
  const nestedCards = cards
    .filter((c) => !c.closest('table') && cards.some((o) => o !== c && o.contains(c)))
    .slice(0, 8)
    .map(path);
  const gradientText = all
    .filter((e) => {
      const s = cs(e) as unknown as Record<string, string>;
      return /text/.test(s.backgroundClip ?? '') || /text/.test(s.webkitBackgroundClip ?? '')
        ? /gradient/.test(s.backgroundImage ?? '') && (e.textContent ?? '').trim().length > 0
        : false;
    })
    .slice(0, 8)
    .map(path);
  const glass = all
    .filter((e) => {
      const s = cs(e) as unknown as Record<string, string>;
      const f = `${s.backdropFilter ?? ''} ${s.webkitBackdropFilter ?? ''}`;
      const bg = rgb(s.backgroundColor ?? '');
      return /blur/.test(f) && !!bg && bg.a < 0.95 && s.position !== 'fixed' && s.position !== 'sticky' && shown(e);
    })
    .slice(0, 12)
    .map(path);
  const glow = all
    .filter((e) => {
      const sh = cs(e).boxShadow;
      if (!sh || sh === 'none') return false;
      return sh.split(/,(?![^(]*\))/).some((part) => {
        const c = rgb(part);
        const nums =
          part
            .replace(COLOR, '')
            .match(/-?[\d.]+px/g)
            ?.map((n) => Number.parseFloat(n)) ?? [];
        const blur = nums[2] ?? 0;
        return !!c && c.a > 0.2 && blur >= 16 && hsl(c).s > 0.5 && hsl(c).l > 0.25 && hsl(c).l < 0.85;
      });
    })
    .slice(0, 8)
    .map(path);
  // An emoji DRAWN as one: emoji presentation by default, or a pictograph asked to be one with
  // U+FE0F. © ® ™ ↔ ▶ are text symbols, not icons.
  const PICT = /^\s*(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F)/u;
  const emojiIcons = leaves
    .filter((e) => e.closest('button,a,nav,h1,h2,h3,h4,li,[role=button]') && PICT.test(ownText(e)))
    .slice(0, 12)
    .map((e) => ({ sel: path(e), text: short(ownText(e), 24) }));
  const sideStripes = all
    .filter((e) => {
      const s = cs(e);
      const L = Number.parseFloat(s.borderLeftWidth),
        R = Number.parseFloat(s.borderRightWidth);
      const T = Number.parseFloat(s.borderTopWidth),
        B = Number.parseFloat(s.borderBottomWidth);
      const side = L >= 3 && R === 0 ? s.borderLeftColor : R >= 3 && L === 0 ? s.borderRightColor : null;
      if (!side || T > 1 || B > 1 || !shown(e)) return false;
      const c = rgb(side);
      return (
        !!c &&
        hsl(c).s > 0.45 &&
        (Number.parseFloat(s.borderTopLeftRadius) > 0 ||
          Number.parseFloat(s.borderTopRightRadius) > 0 ||
          e.getBoundingClientRect().height > 40)
      );
    })
    // One callout with a coloured edge is a choice (a quote, an alert). The tell is the stripe
    // repeated down a row of sibling cards: three or more under one parent.
    .filter((e, _i, striped) => {
      const p = e.parentElement;
      return !!p && striped.filter((o) => o.parentElement === p).length >= 3;
    })
    .slice(0, 8)
    .map(path);
  /*
   * Decoration stacked on one box (MengTo's "decorative stacking"): a gradient fill, a coloured
   * glow, a frosted blur, a coloured ring and an ornamental ::before/::after each do the same
   * job — "look special". One is a choice; three on one box is a box with nothing to say.
   */
  const stacked = all
    .filter((e) => {
      if (!shown(e)) return false;
      const r = e.getBoundingClientRect();
      if (r.width < 120 || r.height < 48) return false;
      const s = cs(e) as unknown as Record<string, string>;
      let n = 0;
      if (/gradient/.test(s.backgroundImage ?? '')) n++;
      const sh = s.boxShadow ?? 'none';
      if (
        sh !== 'none' &&
        sh.split(/,(?![^(]*\))/).some((part) => {
          const c = rgb(part);
          return !!c && c.a > 0.15 && hsl(c).s > 0.4;
        })
      )
        n++;
      if (/blur/.test(`${s.backdropFilter ?? ''} ${s.webkitBackdropFilter ?? ''}`)) n++;
      const bc = rgb(s.borderTopColor ?? '');
      if (Number.parseFloat(s.borderTopWidth ?? '0') >= 1 && bc && bc.a > 0.2 && hsl(bc).s > 0.4) n++;
      for (const pseudo of ['::before', '::after']) {
        const ps = getComputedStyle(e, pseudo) as unknown as Record<string, string>;
        if (
          ps.content &&
          ps.content !== 'none' &&
          ps.content !== 'normal' &&
          /gradient|blur/.test(`${ps.backgroundImage} ${ps.filter}`)
        ) {
          n++;
          break;
        }
      }
      return n >= 3;
    })
    .filter((e, _i, list) => !list.some((o) => o !== e && o.contains(e)))
    .slice(0, 8)
    .map(path);
  /*
   * A label above a heading that says what the heading says ("Features" over "Our features",
   * "Pricing" over "Simple pricing"): copy that restates the copy next to it. A label that adds
   * something ("New in 2.0", "Step 2") is not this.
   */
  const words = (t: string) =>
    (t.toLowerCase().match(/\p{L}{3,}/gu) ?? []).filter((w) => !/^(the|and|for|our|your|with|you|are|new)$/.test(w));
  const restated: string[] = [];
  for (const hd of Array.from(document.querySelectorAll('h1,h2,h3'))) {
    const prev = hd.previousElementSibling;
    if (!prev || !shown(prev) || /^H[1-6]$/.test(prev.tagName)) continue;
    const label = (prev.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!label || label.length > 40 || prev.querySelector('a,button,img,svg')) continue;
    const lw = words(label);
    const hw = new Set(words(hd.textContent ?? ''));
    if (lw.length && lw.every((w) => hw.has(w) || hw.has(w.replace(/s$/, '')) || hw.has(`${w}s`)))
      restated.push(path(prev));
  }
  /*
   * Each heading and the sentence under it, for the narration check (core/narration.ts): the
   * first prose that follows it, in its own block or the one after a heading wrapper. Never a
   * field's hint (something points at it with aria-describedby), text inside <details> or a
   * form, or an empty state; those are allowed to explain.
   */
  const described = new Set(
    Array.from(document.querySelectorAll('[aria-describedby]')).flatMap((e) =>
      (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean),
    ),
  );
  const proseAfter = (hd: Element): Element | null => {
    let next = hd.nextElementSibling;
    if (!next && hd.parentElement && hd.parentElement.children.length <= 2) next = hd.parentElement.nextElementSibling;
    while (next && (!shown(next) || !(next.textContent ?? '').trim())) next = next.nextElementSibling;
    if (!next || /^(H[1-6]|UL|OL|TABLE|FORM|NAV|BUTTON|A|IMG|SVG|INPUT|SELECT|TEXTAREA)$/.test(next.tagName))
      return null;
    if (next.querySelector('h1,h2,h3,h4,h5,h6,input,select,textarea,button,table,ul,ol,img')) return null;
    return next;
  };
  const blurbs: { sel: string; heading: string; text: string; grid?: string }[] = [];
  for (const hd of Array.from(document.querySelectorAll('h1,h2,h3,h4'))) {
    if (!shown(hd) || blurbs.length >= 120) continue;
    const p = proseAfter(hd);
    if (!p || (p.id && described.has(p.id)) || p.closest('details,form,fieldset,label,[role=status]')) continue;
    if (/\b(hint|help|empty|placeholder)\b/i.test(`${p.className}`)) continue;
    const text = (p.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 8 || text.length > 400) continue;
    let card: Element | null = hd.parentElement;
    for (let i = 0; card && i < 3 && !isCard(card); i++) card = card.parentElement;
    const b: (typeof blurbs)[number] = {
      sel: path(p),
      heading: (hd.textContent ?? '').replace(/\s+/g, ' ').trim(),
      text,
    };
    if (card && isCard(card) && card.parentElement) b.grid = path(card.parentElement);
    blurbs.push(b);
  }
  const h1 = document.querySelector('h1');
  let badgeAboveH1: string | null = null;
  if (h1) {
    const prev = h1.previousElementSibling;
    if (prev && shown(prev)) {
      const s = cs(prev);
      const r = prev.getBoundingClientRect();
      const pill = Number.parseFloat(s.borderTopLeftRadius) >= r.height / 2 - 1 && r.height <= 40;
      const filled = (rgb(s.backgroundColor)?.a ?? 0) > 0.05 || Number.parseFloat(s.borderTopWidth) > 0;
      if (pill && filled && (prev.textContent ?? '').trim()) badgeAboveH1 = path(prev);
    }
  }
  let iconTiles = 0;
  for (const hd of Array.from(document.querySelectorAll('h2,h3,h4'))) {
    const prev = hd.previousElementSibling;
    if (!prev || !shown(prev)) continue;
    const r = prev.getBoundingClientRect();
    const s = cs(prev);
    if (
      Math.abs(r.width - r.height) <= 4 &&
      r.width >= 28 &&
      r.width <= 80 &&
      Number.parseFloat(s.borderTopLeftRadius) > 0 &&
      (rgb(s.backgroundColor)?.a ?? 0) > 0.05
    )
      iconTiles++;
  }
  let cardGrids = 0;
  for (const p of all) {
    const kids = Array.from(p.children).filter((k) => isCard(k));
    if (kids.length < 3) continue;
    const r0 = (kids[0] as Element).getBoundingClientRect();
    if (
      kids.every(
        (k) =>
          Math.abs(k.getBoundingClientRect().width - r0.width) < 3 &&
          Math.abs(k.getBoundingClientRect().height - r0.height) < 3,
      )
    )
      cardGrids++;
  }
  const accentHues = all
    .filter((e) => e.matches('button,a,[role=button]') && shown(e))
    .map((e) => rgb(cs(e).backgroundColor))
    .filter((c): c is NonNullable<typeof c> => !!c && c.a > 0.5 && hsl(c).s > 0.45)
    .map((c) => Math.round(hsl(c).h))
    .slice(0, 30);
  const fonts = [
    ...new Set(
      leaves.map((e) =>
        (cs(e).fontFamily.split(',')[0] as string)
          .trim()
          .replace(/^["']|["']$/g, '')
          .toLowerCase(),
      ),
    ),
  ].slice(0, 12);

  return {
    viewport: { width: W, height: H },
    url: location.href,
    scrollWidth,
    overflow,
    clipped,
    overlaps,
    covered,
    pictures,
    brokenImages,
    invisible,
    paragraphs,
    targets,
    controls,
    navs,
    deadLinks,
    doc: docMeta,
    palette,
    forms,
    formLayouts,
    closedDisclosures: Array.from(document.querySelectorAll('details:not([open])')).filter(
      (d) => !d.closest('[aria-hidden="true"],[inert],[hidden]'),
    ).length,
    landmarks,
    headings,
    fontSizes,
    spacing,
    edges,
    textColors,
    contrastUnknown,
    ...(lightControls ? { lightControls } : {}),
    texts,
    imageSrcs,
    slop: {
      gradientText,
      glass,
      glow,
      emojiIcons,
      sideStripes,
      stacked,
      restated,
      blurbs,
      nestedCards,
      badgeAboveH1,
      iconTiles,
      cardGrids,
      accentHues,
      fonts,
    },
  };
}
