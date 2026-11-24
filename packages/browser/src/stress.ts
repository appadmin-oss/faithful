/**
 * The i18n / resilience stress passes `faithful audit --stress` applies before measuring.
 * SERIALISED with Function#toString and run in the probe's isolated world: the DOM is shared
 * with the page, so text rewritten or an attribute set here is what the page lays out; only
 * the JavaScript globals are private. Each says whether it took, so a pass that could not
 * apply is reported as unmeasured rather than as a clean page.
 */

/**
 * Pseudo-localise every visible text node in place, lengthened by the W3C's expansion ratios
 * for translation from English (https://www.w3.org/International/articles/article-text-size):
 * ≤10 characters 200%, 11–20 180%, 21–30 160%, 31–50 140%, over 50 130%. Letters are
 * accented and accented filler words appended, so "Save" becomes "Šàvé ŀŏŕé": obviously not
 * English, still text of the same shape. Code, form values, hidden text and figures are left.
 */
export function expandText(): { applied: boolean; nodes: number } {
  const ACCENT: Record<string, string> = {
    a: 'à',
    e: 'é',
    i: 'ì',
    o: 'ö',
    u: 'ü',
    c: 'ç',
    n: 'ñ',
    s: 'š',
    z: 'ž',
    y: 'ý',
    A: 'Å',
    E: 'É',
    I: 'Î',
    O: 'Ö',
    U: 'Ü',
    C: 'Ç',
    N: 'Ñ',
    S: 'Š',
    Z: 'Ž',
    Y: 'Ý',
  };
  const FILLER = ['ŀŏŕé', 'ìpšüm', 'đŏŀŏŕ', 'šìţ', 'àméţ', 'çŏñšéçţ', 'àđìpìšç', 'éŀìţ'];
  const SKIP = 'script,style,code,pre,kbd,samp,textarea,noscript,template,svg,math,[aria-hidden="true"],[hidden]';
  const ratio = (n: number) => (n <= 10 ? 2 : n <= 20 ? 1.8 : n <= 30 ? 1.6 : n <= 50 ? 1.4 : 1.3);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const todo: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const core = (t.data ?? '').trim();
    // Figures, prices and dates stay as they are: they are not translated, only formatted.
    if (!core || !/\p{L}/u.test(core)) continue;
    const p = t.parentElement;
    if (!p || p.closest(SKIP)) continue;
    const s = getComputedStyle(p);
    if (s.display === 'none' || s.visibility !== 'visible' || !p.getClientRects().length) continue;
    todo.push(t);
  }
  // Read everything first, then write: no layout thrashing between the two.
  for (const t of todo) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(t.data) as RegExpExecArray;
    const core = m[2] as string;
    const want = Math.ceil(core.length * ratio(core.length));
    let out = Array.from(core, (ch) => ACCENT[ch] ?? ch).join('');
    for (let i = 0; out.length < want; i++) out += ` ${FILLER[i % FILLER.length]}`;
    // Whole filler words, but never more than a letter or two past the ratio.
    if (out.length > want + 1) out = out.slice(0, want).trimEnd();
    t.data = `${m[1]}${out}${m[3]}`;
  }
  return { applied: true, nodes: todo.length };
}

/**
 * WCAG 1.4.4 Resize Text: every piece of text at 200%, the layout left as it is, the way a
 * reader's text-only zoom or larger default font does it. Media queries do not see it, so a
 * menu that fits at 1440 wraps or cuts off its last item — what a screenshot never shows
 * (MAM Academy, Nov 2026: at 175% text the desktop nav wrapped and its last button was cut).
 * Every size is read first, then written, so a parent's doubling is not doubled again.
 */
export function zoomText(): { applied: boolean; nodes: number } {
  const SKIP = 'script,style,noscript,template,svg,math,[hidden]';
  const els: [HTMLElement, number][] = [];
  for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
    if (el.closest(SKIP)) continue;
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && /\S/.test(n.textContent ?? ''));
    const field = /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName);
    if (!own && !field) continue;
    els.push([el, Number.parseFloat(getComputedStyle(el).fontSize) || 16]);
  }
  for (const [el, size] of els) el.style.setProperty('font-size', `${size * 2}px`, 'important');
  const first = els[0];
  return {
    applied: !first || Number.parseFloat(getComputedStyle(first[0]).fontSize) >= first[1] * 1.9,
    nodes: els.length,
  };
}

/** Right-to-left, the way a translated page declares it: `dir` on the root element. */
export function setRtl(): { applied: boolean } {
  document.documentElement.setAttribute('dir', 'rtl');
  return { applied: getComputedStyle(document.body).direction === 'rtl' };
}

/**
 * WCAG 1.4.12 Text Spacing: the user's own overrides that content must survive. A user
 * stylesheet beats the author's `!important`; an injected one is the author's, so the
 * selectors carry three ids' worth of specificity (`:is()` takes its weightiest argument) to
 * win the same way. Read back afterwards, in case the page refused it.
 */
export function setSpacing(): { applied: boolean } {
  const all = ':is(*,#f-#f-#f-)';
  const css = `${all}{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p${all}{margin-bottom:2em!important}`;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    const el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
  }
  const fs = Number.parseFloat(getComputedStyle(document.body).fontSize) || 16;
  const ls = Number.parseFloat(getComputedStyle(document.body).letterSpacing) || 0;
  return { applied: Math.abs(ls - 0.12 * fs) < 0.5 };
}
