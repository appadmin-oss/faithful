/**
 * The facts `faithful audit` reads off a rendered page with no design to compare against.
 * SERIALISED with Function#toString and run in the page, so it must stay self-contained.
 *
 * It only MEASURES. Every judgement — what counts as clipped, how many tells make a page read
 * as generated — is made in `@faithful/core`'s `scoreAudit()`, where it can be tested without
 * a browser and tuned without re-rendering anything.
 */
import type { AuditFacts } from '@faithful/core';

export function auditProbe(): AuditFacts {
  const W = window.innerWidth;
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
  const rgb = (c: string) => {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c);
    return m ? { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) } : null;
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
      if (r.right <= W + 1) continue;
      const p = e.parentElement;
      if (p && p !== document.body && p.getBoundingClientRect().right > W + 1) continue;
      if (insideScroller(e)) continue;
      overflow.push({ sel: path(e), right: Math.round(r.right), text: short(e.textContent ?? '', 40) });
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
    const victim = leaves.find((t) => {
      if (!e.contains(t)) return false;
      const r = textRect(t);
      return (
        (cutY && r.bottom > box.bottom + 2 && r.top < box.bottom) ||
        (cutX && r.right > box.right + 2 && r.left < box.right)
      );
    });
    if (!victim) continue;
    const r = textRect(victim);
    const axis = cutY && r.bottom > box.bottom + 2 ? 'y' : 'x';
    clipped.push({
      sel: path(e),
      text: short(ownText(victim), 40),
      axis,
      by: Math.round(axis === 'y' ? r.bottom - box.bottom : r.right - box.right),
    });
    if (clipped.length >= 12) break;
  }

  // ── Text drawn on text, and text covered in the first screen ──────────────────────
  const solid = leaves.filter((e) => opacityOf(e) > 0.5).slice(0, 700);
  const rects = solid.map((e) => e.getBoundingClientRect());
  /* Text is compared LINE BY LINE. An inline run that wraps has a bounding box spanning both
     of its lines, so two neighbouring inline links on wrapped lines, or a 40px price beside
     the small "/ term" that wraps under it, "overlapped" with no glyph touching another —
     reported as an error on a page with nothing wrong. Each line box of the text is tested
     instead; text genuinely drawn over text still intersects line for line. */
  const lines = solid.map((e) => {
    const range = document.createRange();
    range.selectNodeContents(e);
    return Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  });
  const overlaps: AuditFacts['overlaps'] = [];
  for (let i = 0; i < solid.length && overlaps.length < 12; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i] as Element,
        b = solid[j] as Element;
      if (a.contains(b) || b.contains(a)) continue;
      const A = rects[i] as DOMRect,
        B = rects[j] as DOMRect;
      if (
        Math.min(A.right, B.right) <= Math.max(A.left, B.left) ||
        Math.min(A.bottom, B.bottom) <= Math.max(A.top, B.top)
      )
        continue;
      const hit = (lines[i] as DOMRect[]).some((p) =>
        (lines[j] as DOMRect[]).some((q) => {
          const w = Math.min(p.right, q.right) - Math.max(p.left, q.left);
          const h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
          if (w <= 0 || h <= 0) return false;
          const small = Math.min(p.width * p.height, q.width * q.height);
          return w * h >= 0.25 * small && w * h >= 40;
        }),
      );
      if (!hit) continue;
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
  for (const e of all) {
    if (
      !e.matches(
        'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab],[role=checkbox]',
      )
    )
      continue;
    if (!shown(e)) continue;
    // A link inside running text is exempt (WCAG 2.5.8 "inline").
    if (
      e.tagName === 'A' &&
      cs(e).display === 'inline' &&
      (e.parentElement?.textContent ?? '').trim().length > (e.textContent ?? '').trim().length + 20
    )
      continue;
    const r = e.getBoundingClientRect();
    if (r.width < 24 || r.height < 24)
      targets.push({
        sel: path(e),
        text: short(e.textContent || e.getAttribute('aria-label') || '', 30),
        w: Math.round(r.width),
        h: Math.round(r.height),
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
      method: (form.getAttribute('method') ?? 'get').toLowerCase(),
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
            .replace(/rgba?\([^)]*\)/, '')
            .match(/-?[\d.]+px/g)
            ?.map((n) => Number.parseFloat(n)) ?? [];
        const blur = nums[2] ?? 0;
        return !!c && c.a > 0.2 && blur >= 16 && hsl(c).s > 0.5 && hsl(c).l > 0.25 && hsl(c).l < 0.85;
      });
    })
    .slice(0, 8)
    .map(path);
  const PICT = /^\s*\p{Extended_Pictographic}/u;
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
    .slice(0, 8)
    .map(path);
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
    forms,
    landmarks,
    headings,
    fontSizes,
    texts,
    imageSrcs,
    slop: {
      gradientText,
      glass,
      glow,
      emojiIcons,
      sideStripes,
      nestedCards,
      badgeAboveH1,
      iconTiles,
      cardGrids,
      accentHues,
      fonts,
    },
  };
}
