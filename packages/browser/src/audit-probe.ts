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
  const shown = (e: Element) => {
    const s = cs(e);
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return false;
    const r = e.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const ariaHidden = (e: Element) => !!e.closest('[aria-hidden="true"],[hidden],template,noscript');
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
    clipped.push({
      sel: path(e),
      text: short(ownText(victim), 40),
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
  const overlaps: AuditFacts['overlaps'] = [];
  const collide = (P: DOMRect[], Q: DOMRect[]) =>
    P.some((A) =>
      Q.some((B) => {
        const w = Math.min(A.right, B.right) - Math.max(A.left, B.left);
        const h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
        if (w <= 0 || h <= 0) return false;
        const small = Math.min(A.width * A.height, B.width * B.height);
        return w * h >= 0.25 * small && w * h >= 40;
      }),
    );
  for (let i = 0; i < solid.length && overlaps.length < 12; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i] as Element,
        b = solid[j] as Element;
      if (a.contains(b) || b.contains(a)) continue;
      if (!collide(rects[i] as DOMRect[], rects[j] as DOMRect[])) continue;
      overlaps.push({ a: path(a), b: path(b), text: short(ownText(a), 30), other: short(ownText(b), 30) });
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
    covered.push({ sel: path(e), text: short(ownText(e), 30), by: path(hit) });
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
      return r.width > 4 && r.height > 4 && opacityOf(e) < 0.05;
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
  for (const e of all) {
    if (!e.matches(TARGET)) continue;
    if (!shown(e)) continue;
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
    if (
      e.matches('button,a[href],[role=button],input[type=submit]') &&
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
    }));
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
  const nestedCards = cards
    .filter((c) => cards.some((o) => o !== c && o.contains(c)))
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
    landmarks,
    headings,
    fontSizes,
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
      nestedCards,
      badgeAboveH1,
      iconTiles,
      cardGrids,
      accentHues,
      fonts,
    },
  };
}
