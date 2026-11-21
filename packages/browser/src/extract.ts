/**
 * The in-page reader. This function is SERIALISED into the page by Playwright, so it must be
 * self-contained: no imports, no closures over module scope, nothing but DOM APIs.
 *
 * What it returns per element is what a person compares when they hold a build against a
 * design: the words, where they sit, and how they look — read from the browser's computed
 * style, never from the source CSS, because only the browser knows what the cascade decided.
 *
 * Text is read as BLOCKS: an element with text whose block-level descendants have none. So
 * "Save <b>now</b>" is one text, as a reader sees it, and a card is not reported as one long
 * string of everything inside it. The text's box is the box of the GLYPHS (a Range), not of
 * the element: a heading in a full-width block is 300px of words, not 1200px of block.
 */

export interface RawElement {
  id: string;
  kind: 'text' | 'box' | 'image' | 'control';
  text?: string;
  box: { x: number; y: number; w: number; h: number };
  style: Record<string, string | number>;
  role?: string;
  region?: string;
  interactive?: boolean;
  /** Its text is all its own (no child elements): one font speaks for it. */
  leaf?: boolean;
}

export interface RawPage {
  elements: RawElement[];
  regions: Array<{ id: string; name: string; box: { x: number; y: number; w: number; h: number } }>;
  pageHeight: number;
  truncated: boolean;
  /** Families named in font-family that the page asked for, and which it could not load. */
  fontsFailed: string[];
  /** Every family declared with @font-face. */
  fontFaces: string[];
}

export function extractPage(opts: { ignore: string[]; max: number }): RawPage {
  const SKIP = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEMPLATE',
    'HEAD',
    'META',
    'LINK',
    'TITLE',
    'BR',
    'WBR',
    'OPTION',
  ]);
  const INTERACTIVE =
    'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=option],[tabindex]:not([tabindex="-1"])';
  const LANDMARK =
    'header,nav,main,footer,aside,form[aria-label],section[aria-label],section[aria-labelledby],[role=banner],[role=navigation],[role=main],[role=contentinfo],[role=complementary],[role=region],[role=dialog]';
  const sx = window.scrollX;
  const sy = window.scrollY;
  const ignored = opts.ignore.length ? Array.from(document.querySelectorAll(opts.ignore.join(','))) : [];
  const isIgnored = (el: Element) => ignored.some((i) => i === el || i.contains(el));

  const ids = new Map<Element, string>();
  const cssPath = (el: Element): string => {
    const known = ids.get(el);
    if (known) return known;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.documentElement && parts.length < 5) {
      const tag = cur.tagName.toLowerCase();
      if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id) && document.querySelectorAll(`#${cur.id}`).length === 1) {
        parts.unshift(`#${cur.id}`);
        break;
      }
      const cls = Array.from(cur.classList).find((c) => /^[A-Za-z_][\w-]*$/.test(c) && !/^(is|has)-/.test(c));
      let seg = cls ? `${tag}.${cls}` : tag;
      const parent: Element | null = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(
          (c) => c.tagName === cur?.tagName && (!cls || c.classList.contains(cls)),
        );
        if (same.length > 1)
          seg += `:nth-of-type(${
            Array.from(parent.children)
              .filter((c) => c.tagName === cur?.tagName)
              .indexOf(cur) + 1
          })`;
      }
      parts.unshift(seg);
      const sel = parts.join('>');
      try {
        if (document.querySelectorAll(sel).length === 1) break;
      } catch {
        break;
      }
      cur = parent;
    }
    const id = parts.join('>');
    ids.set(el, id);
    return id;
  };

  const visible = (_el: Element, cs: CSSStyleDeclaration): boolean => {
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    if (Number.parseFloat(cs.opacity) === 0) return false;
    return true;
  };
  const toBox = (r: DOMRect) => ({ x: r.left + sx, y: r.top + sy, w: r.width, h: r.height });
  const px = (v: string): number | undefined => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const transparent = (c: string) => !c || c === 'transparent' || /rgba?\([^)]*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
  /* The text a reader is SHOWN: textContent also returns the words of a child that is
     display:none, [hidden] or visibility:hidden — a closed "· Start over" link beside
     "Progress saved" was read as part of the copy and reported as a copy change. */
  const shownText = (n: Node): string => {
    if (n.nodeType === 3) return n.textContent ?? '';
    if (n.nodeType !== 1) return '';
    const el = n as Element;
    if ((el as HTMLElement).hidden) return '';
    const c = getComputedStyle(el);
    if (c.display === 'none' || c.visibility === 'hidden' || c.visibility === 'collapse') return '';
    let out = '';
    for (const k of Array.from(el.childNodes)) out += shownText(k);
    return out;
  };
  const ownText = (el: Element) =>
    Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '');
  const isBlock = (cs: CSSStyleDeclaration) => !/^inline/.test(cs.display) && cs.display !== 'contents';

  const textStyle = (cs: CSSStyleDeclaration) => {
    const st: Record<string, string | number> = {
      color: cs.color,
      fontFamily: cs.fontFamily,
      textTransform: cs.textTransform,
    };
    const fs = px(cs.fontSize);
    if (fs !== undefined) st.fontSize = fs;
    const fw = Number.parseInt(cs.fontWeight, 10);
    if (Number.isFinite(fw)) st.fontWeight = fw;
    const lh = px(cs.lineHeight);
    if (lh !== undefined) st.lineHeight = lh;
    st.letterSpacing = cs.letterSpacing === 'normal' ? 0 : (px(cs.letterSpacing) ?? 0);
    return st;
  };
  const boxStyle = (cs: CSSStyleDeclaration) => {
    const st: Record<string, string | number> = {};
    if (!transparent(cs.backgroundColor)) st.background = cs.backgroundColor;
    const bw = Math.max(
      px(cs.borderTopWidth) ?? 0,
      px(cs.borderRightWidth) ?? 0,
      px(cs.borderBottomWidth) ?? 0,
      px(cs.borderLeftWidth) ?? 0,
    );
    if (bw > 0 && cs.borderStyle !== 'none' && !transparent(cs.borderTopColor)) {
      st.borderWidth = bw;
      st.borderColor = cs.borderTopColor;
    }
    const r = px(cs.borderTopLeftRadius);
    if (r !== undefined) st.radius = r;
    const op = Number.parseFloat(cs.opacity);
    if (op < 1) st.opacity = op;
    return st;
  };

  // Does this element (or its subtree) hold text, and does any BLOCK descendant hold it?
  const hasText = new Map<Element, boolean>();
  const holds = (el: Element): boolean => {
    const k = hasText.get(el);
    if (k !== undefined) return k;
    const v = (el.textContent ?? '').trim() !== '';
    hasText.set(el, v);
    return v;
  };

  const regionOf = (el: Element): string | undefined => {
    const lm = el.closest(LANDMARK);
    return lm ? cssPath(lm) : undefined;
  };
  const label = (el: Element): string => {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    if (el instanceof HTMLInputElement) {
      if (['submit', 'button', 'reset'].includes(el.type)) return el.value;
      return el.placeholder || el.getAttribute('title') || '';
    }
    const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t) return t;
    const img = el.querySelector('img[alt]');
    return img?.getAttribute('alt')?.trim() || el.getAttribute('title') || '';
  };

  const out: RawElement[] = [];
  const controls = new Set(Array.from(document.querySelectorAll(INTERACTIVE)));
  const all = Array.from(document.body.querySelectorAll('*'));
  // One pass from the leaves up: does any BLOCK descendant hold visible text? Linear, where
  // asking each element about its whole subtree would be quadratic on a long page.
  const styles = new Map<Element, CSSStyleDeclaration>();
  const styleOf = (e: Element) => {
    let c = styles.get(e);
    if (!c) {
      c = getComputedStyle(e);
      styles.set(e, c);
    }
    return c;
  };
  const blockText = new Map<Element, boolean>();
  for (let i = all.length - 1; i >= 0; i--) {
    const e = all[i] as Element;
    let v = false;
    for (const c of Array.from(e.children)) {
      if (blockText.get(c)) {
        v = true;
        break;
      }
      if (c.closest('svg') || !holds(c)) continue;
      const ccs = styleOf(c);
      if (isBlock(ccs) && visible(c, ccs) && c.getBoundingClientRect().height > 0) {
        v = true;
        break;
      }
    }
    blockText.set(e, v);
  }
  for (const el of all) {
    if (out.length >= opts.max) break;
    const svgRoot = el.closest('svg');
    if (SKIP.has(el.tagName) || (svgRoot && svgRoot !== el) || isIgnored(el)) continue;
    const cs = styleOf(el);
    if (!visible(el, cs)) continue;
    // An ancestor at opacity 0 hides its subtree without changing the subtree's own style.
    if (
      typeof el.checkVisibility === 'function' &&
      !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    )
      continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const tag = el.tagName;
    const role = el.getAttribute('role') ?? undefined;

    // Images.
    const bgImg = cs.backgroundImage && cs.backgroundImage !== 'none' && /url\(/.test(cs.backgroundImage);
    if (tag === 'IMG' || tag === 'svg' || tag === 'VIDEO' || tag === 'CANVAS' || tag === 'PICTURE' || bgImg) {
      if (tag !== 'PICTURE') {
        const e: RawElement = { id: cssPath(el), kind: 'image', box: toBox(r), style: boxStyle(cs) };
        const reg = regionOf(el);
        if (reg) e.region = reg;
        if (role) e.role = role;
        out.push(e);
      }
      if (tag !== 'PICTURE' && !bgImg) continue;
    }

    // Controls: one element with its accessible label; their inner text is not read again.
    if (controls.has(el)) {
      const e: RawElement = {
        id: cssPath(el),
        kind: 'control',
        box: toBox(r),
        style: { ...boxStyle(cs), ...textStyle(cs) },
        interactive: true,
      };
      const t = label(el);
      if (t) e.text = t;
      e.role = role ?? tag.toLowerCase();
      const reg = regionOf(el);
      if (reg) e.region = reg;
      out.push(e);
      continue;
    }
    if (el.closest(INTERACTIVE) && el.closest(INTERACTIVE) !== el) continue;

    // Text blocks.
    if (holds(el) && isBlock(cs)) {
      const blockKids = blockText.get(el) === true;
      const emit = (text: string, rr: { left: number; top: number; width: number; height: number }) => {
        if (!text || rr.width <= 0 || rr.height <= 0) return;
        const e: RawElement = {
          id: cssPath(el),
          kind: 'text',
          text,
          box: { x: rr.left + sx, y: rr.top + sy, w: rr.width, h: rr.height },
          style: textStyle(cs),
        };
        if (el.children.length === 0) e.leaf = true;
        const reg = regionOf(el);
        if (reg) e.region = reg;
        if (role) e.role = role;
        out.push(e);
      };
      if (!blockKids) {
        const range = document.createRange();
        range.selectNodeContents(el);
        emit(shownText(el).replace(/\s+/g, ' ').trim(), range.getBoundingClientRect());
      } else if (ownText(el)) {
        // Mixed content — loose words beside block children ("Total <div>…</div> due"): the
        // loose words and their inline neighbours are a text of their own, boxed by their glyphs.
        const parts: string[] = [];
        let x1 = Infinity,
          y1 = Infinity,
          x2 = -Infinity,
          y2 = -Infinity;
        for (const n of Array.from(el.childNodes)) {
          const inline = n.nodeType === 3 || (n.nodeType === 1 && !isBlock(styleOf(n as Element)));
          if (!inline || shownText(n).trim() === '') continue;
          parts.push(shownText(n).trim());
          const range = document.createRange();
          range.selectNodeContents(n);
          const b = range.getBoundingClientRect();
          if (b.width <= 0 || b.height <= 0) continue;
          x1 = Math.min(x1, b.left);
          y1 = Math.min(y1, b.top);
          x2 = Math.max(x2, b.right);
          y2 = Math.max(y2, b.bottom);
        }
        if (Number.isFinite(x1))
          emit(parts.join(' ').replace(/\s+/g, ' '), { left: x1, top: y1, width: x2 - x1, height: y2 - y1 });
      }
    }

    // Boxes: anything that paints a surface — fill, border or shadow.
    const st = boxStyle(cs);
    if (
      (st.background !== undefined || st.borderWidth !== undefined || cs.boxShadow !== 'none') &&
      r.width >= 4 &&
      r.height >= 4
    ) {
      if (cs.boxShadow !== 'none')
        st.shadow = cs.boxShadow.length > 80 ? `${cs.boxShadow.slice(0, 80)}…` : cs.boxShadow;
      const e: RawElement = { id: cssPath(el), kind: 'box', box: toBox(r), style: st };
      const reg = regionOf(el);
      if (reg) e.region = reg;
      if (role) e.role = role;
      out.push(e);
    }
  }

  const regions = Array.from(document.querySelectorAll(LANDMARK)).map((lm) => {
    const name =
      lm.getAttribute('aria-label') ??
      (lm.getAttribute('aria-labelledby')
        ? document.getElementById(lm.getAttribute('aria-labelledby') ?? '')?.textContent?.trim()
        : undefined) ??
      lm.tagName.toLowerCase();
    return { id: cssPath(lm), name: name ?? lm.tagName.toLowerCase(), box: toBox(lm.getBoundingClientRect()) };
  });

  const failed: string[] = [];
  const faces: string[] = [];
  try {
    document.fonts.forEach((f) => {
      const fam = f.family.replace(/^["']|["']$/g, '');
      faces.push(fam);
      if (f.status === 'error') failed.push(fam);
    });
  } catch {
    /* no Font Loading API */
  }

  return {
    elements: out,
    regions,
    pageHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    truncated: out.length >= opts.max,
    fontsFailed: [...new Set(failed)],
    fontFaces: [...new Set(faces)],
  };
}
