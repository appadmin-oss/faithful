/**
 * A runtime for Claude Design `.dc.html` handoffs, injected into the page before its own
 * scripts. SERIALISED with Function#toString, so it must stay self-contained.
 *
 * A handoff is a template inside `<x-dc>` — `{{ path }}` holes, `<sc-if value>`,
 * `<sc-for list as>`, `on*`/`ref`/`value` bindings, `style-hover` — driven by a
 * `class Component extends DCLogic` whose `renderVals()` returns the values object. The file
 * expects a `support.js` beside it to do that, and handoffs routinely arrive without it (and
 * without their data scripts). Rather than refuse, this renders the template itself:
 *
 *   runtime  the component's own logic, mounted, so every value is the designer's own
 *   static   when the logic cannot run (data missing, an error): the template with its own
 *            preview hints (`hint-placeholder-val`, `hint-placeholder-count`) and every hole
 *            marked, so the literal copy and the literal styles are still read and nothing
 *            invented is.
 *
 * It sets `window.__dcMode` (`runtime` | `static` | `none`), `window.__dcErrors` and, when the
 * page has settled, `window.__dcReady`.
 */
export function dcRuntime(opts: { mode: 'auto' | 'static'; hole: string }): void {
  // biome-ignore lint/suspicious/noExplicitAny: a page global shim
  const w = window as any;
  w.__dcErrors = [];
  w.__dcMode = 'pending';
  w.__dcReady = false;
  const HOLE = opts.hole;
  const BOOL = new Set([
    'disabled',
    'checked',
    'selected',
    'hidden',
    'readonly',
    'required',
    'open',
    'multiple',
    'autofocus',
  ]);
  let schedule: () => void = () => undefined;

  class DCLogic {
    // biome-ignore lint/suspicious/noExplicitAny: designer-written component
    props: any;
    // biome-ignore lint/suspicious/noExplicitAny: designer-written component
    state: any = {};
    // biome-ignore lint/suspicious/noExplicitAny: designer-written component
    constructor(props: any) {
      this.props = props;
    }
    // biome-ignore lint/suspicious/noExplicitAny: designer-written component
    setState(u: any, cb?: () => void): void {
      const next = typeof u === 'function' ? u(this.state, this.props) : u;
      this.state = Object.assign({}, this.state, next);
      schedule();
      if (cb) setTimeout(cb, 0);
    }
    forceUpdate(): void {
      schedule();
    }
  }
  w.DCLogic = DCLogic;
  // Some handoffs build part of a value in code (`React.createElement('span', {style}, …)`)
  // and put it in a hole. Here an element is a real DOM node, made on the spot: a style object
  // becomes inline CSS, `className` a class, `on*` a listener; a Fragment is a fragment.
  const FRAG = 'fragment';
  const kebab = (k: string) => (k.startsWith('--') ? k : k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
  const UNITLESS = /^(opacity|zIndex|fontWeight|lineHeight|flex|flexGrow|flexShrink|order|zoom)$/;
  // biome-ignore lint/suspicious/noExplicitAny: React-shaped arguments
  const append = (parent: Node, c: any) => {
    if (c === null || c === undefined || c === false || c === true) return;
    if (Array.isArray(c)) {
      for (const x of c) append(parent, x);
      return;
    }
    parent.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  // biome-ignore lint/suspicious/noExplicitAny: React-shaped arguments
  const createElement = (type: any, props: any, ...children: any[]): Node => {
    if (typeof type === 'function') return createElement(FRAG, null, type({ ...(props ?? {}), children }));
    const el: Node = type === FRAG ? document.createDocumentFragment() : document.createElement(String(type));
    if (el instanceof HTMLElement) {
      for (const [k, v] of Object.entries(props ?? {})) {
        if (k === 'key' || k === 'children' || v === null || v === undefined || v === false) continue;
        if (k === 'style' && typeof v === 'object') {
          for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
            if (sv === null || sv === undefined || sv === '') continue;
            el.style.setProperty(kebab(sk), typeof sv === 'number' && !UNITLESS.test(sk) ? `${sv}px` : String(sv));
          }
        } else if (k === 'className') el.setAttribute('class', String(v));
        else if (k === 'htmlFor') el.setAttribute('for', String(v));
        else if (k === 'ref') {
          if (typeof v === 'object') (v as { current: unknown }).current = el;
        } else if (/^on[A-Z]/.test(k) && typeof v === 'function')
          el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    append(el, children.length ? children : props?.children);
    return el;
  };
  w.React = w.React ?? {};
  w.React.createRef ??= () => ({ current: null });
  w.React.Fragment ??= FRAG;
  w.React.createElement ??= createElement;

  const boot = () => {
    const host = document.querySelector('x-dc');
    if (!host) {
      w.__dcMode = 'none';
      w.__dcReady = true;
      return;
    }
    const helmet = host.querySelector(':scope > helmet');
    if (helmet) {
      // Its styles and links belong in the head; its scripts have already run.
      for (const n of Array.from(helmet.children))
        if (n.tagName === 'STYLE' || n.tagName === 'LINK') document.head.appendChild(n);
      helmet.remove();
    }
    const tpl = host.cloneNode(true) as Element;
    host.innerHTML = '';
    const scriptEl = document.querySelector('script[data-dc-script]');
    // biome-ignore lint/suspicious/noExplicitAny: designer-written props
    const props: Record<string, any> = {};
    try {
      const decl = JSON.parse(scriptEl?.getAttribute('data-props') ?? '{}');
      for (const [k, v] of Object.entries(decl)) props[k] = (v as { default?: unknown }).default;
    } catch (e) {
      w.__dcErrors.push(`data-props: ${(e as Error).message}`);
    }

    // biome-ignore lint/suspicious/noExplicitAny: values object from the component
    let vals: any = {};
    let isStatic = opts.mode === 'static';
    // biome-ignore lint/suspicious/noExplicitAny: scope of loop variables
    const get = (path: string, scope: Record<string, any>): any => {
      if (isStatic) return HOLE;
      const parts = path.trim().split('.');
      const head = parts[0] as string;
      if (head === 'true') return true;
      if (head === 'false') return false;
      // biome-ignore lint/suspicious/noExplicitAny: walking designer data
      let cur: any = head in scope ? scope[head] : vals?.[head];
      for (const p of parts.slice(1)) cur = cur == null ? undefined : cur[p];
      return cur;
    };
    const EXPR = /\{\{\s*([^}]+?)\s*\}\}/g;
    const ONE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
    // biome-ignore lint/suspicious/noExplicitAny: interpolated value
    const str = (v: any): string => (v === null || v === undefined || v === false || v === true ? '' : String(v));
    // biome-ignore lint/suspicious/noExplicitAny: scope of loop variables
    const interp = (s: string, scope: Record<string, any>) => s.replace(EXPR, (_, p: string) => str(get(p, scope)));
    const hint = (el: Element, name: string): string | null => el.getAttribute(name);

    // biome-ignore lint/suspicious/noExplicitAny: scope of loop variables
    const build = (node: Node, scope: Record<string, any>, out: Node[]) => {
      if (node.nodeType === 3) {
        const raw = node.textContent ?? '';
        if (isStatic || !raw.includes('{{')) {
          out.push(document.createTextNode(interp(raw, scope)));
          return;
        }
        // Piece by piece, so a hole holding an element (or a list of them) is drawn as one.
        let last = 0;
        for (const m of raw.matchAll(EXPR)) {
          if ((m.index ?? 0) > last) out.push(document.createTextNode(raw.slice(last, m.index)));
          const v = get(m[1] as string, scope);
          const frag = document.createDocumentFragment();
          if (v instanceof Node || Array.isArray(v)) append(frag, v);
          else frag.appendChild(document.createTextNode(str(v)));
          out.push(frag);
          last = (m.index ?? 0) + m[0].length;
        }
        if (last < raw.length) out.push(document.createTextNode(raw.slice(last)));
        return;
      }
      if (node.nodeType !== 1) return;
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'sc-if') {
        let on: boolean;
        if (isStatic) {
          const h = hint(el, 'hint-placeholder-val');
          on = h === null ? true : !/\{\{\s*false\s*\}\}/.test(h);
        } else {
          const m = ONE.exec(el.getAttribute('value') ?? '');
          on = !!(m ? get(m[1] as string, scope) : false);
        }
        if (on) for (const c of Array.from(el.childNodes)) build(c, scope, out);
        return;
      }
      if (tag === 'sc-for') {
        const as = el.getAttribute('as') ?? 'item';
        // biome-ignore lint/suspicious/noExplicitAny: list items
        let list: any[] = [];
        if (isStatic)
          list = Array.from(
            { length: Math.max(1, Number.parseInt(hint(el, 'hint-placeholder-count') ?? '1', 10) || 1) },
            () => ({}),
          );
        else {
          const m = ONE.exec(el.getAttribute('list') ?? '');
          const v = m ? get(m[1] as string, scope) : [];
          list = Array.isArray(v) ? v : [];
        }
        list.forEach((item, i) => {
          for (const c of Array.from(el.childNodes)) build(c, { ...scope, [as]: item, [`${as}Index`]: i }, out);
        });
        return;
      }
      if (tag === 'dc-import') {
        const ph = document.createElement('div');
        ph.setAttribute('data-dc-import', el.getAttribute('name') ?? '');
        const st = el.getAttribute('style');
        if (st && !st.includes('{{')) ph.setAttribute('style', st);
        w.__dcErrors.push(`dc-import "${el.getAttribute('name')}" is drawn as an empty box`);
        out.push(ph);
        return;
      }
      const copy = el.cloneNode(false) as HTMLElement;
      // biome-ignore lint/suspicious/noExplicitAny: bound value
      let value: any;
      let hasValue = false;
      for (const a of Array.from(el.attributes)) {
        const name = a.name;
        const raw = a.value;
        if (name.startsWith('hint-')) {
          copy.removeAttribute(name);
          continue;
        }
        if (name === 'style-hover') {
          copy.removeAttribute(name);
          if (!isStatic) {
            const extra = interp(raw, scope);
            const base = () => copy.getAttribute('style') ?? '';
            let saved = '';
            copy.addEventListener('mouseenter', () => {
              saved = base();
              copy.setAttribute('style', `${saved};${extra}`);
            });
            copy.addEventListener('mouseleave', () => copy.setAttribute('style', saved));
          }
          continue;
        }
        if (!raw.includes('{{')) continue;
        const one = ONE.exec(raw);
        if (name === 'style') {
          if (isStatic) {
            // Keep every literal declaration; drop the ones whose value is data.
            copy.setAttribute(
              'style',
              raw
                .split(';')
                .filter((d) => !d.includes('{{'))
                .join(';'),
            );
          } else copy.setAttribute('style', interp(raw, scope));
          continue;
        }
        copy.removeAttribute(name);
        if (isStatic) continue;
        const v = one ? get(one[1] as string, scope) : interp(raw, scope);
        if (name === 'ref') {
          if (v && typeof v === 'object') v.current = copy;
          continue;
        }
        if (/^on[A-Z]/.test(name)) {
          if (typeof v !== 'function') continue;
          let ev = name.slice(2).toLowerCase();
          if (ev === 'change' && (tag === 'input' || tag === 'textarea')) ev = 'input';
          if (ev === 'doubleclick') ev = 'dblclick';
          copy.addEventListener(ev, (e) => {
            if (ev === 'submit') e.preventDefault();
            v(e);
          });
          continue;
        }
        if (name === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
          value = v;
          hasValue = true;
          continue;
        }
        if (BOOL.has(name)) {
          if (v) copy.setAttribute(name, '');
          continue;
        }
        if (v === null || v === undefined || (v === false && !name.startsWith('aria-'))) continue;
        copy.setAttribute(name, String(v));
      }
      const kids: Node[] = [];
      for (const c of Array.from(el.childNodes)) build(c, scope, kids);
      for (const k of kids) copy.appendChild(k);
      if (hasValue) (copy as HTMLInputElement).value = str(value);
      out.push(copy);
    };

    const paint = () => {
      const nodes: Node[] = [];
      for (const c of Array.from(tpl.childNodes)) build(c, {}, nodes);
      host.replaceChildren(...nodes);
    };

    // biome-ignore lint/suspicious/noExplicitAny: designer-written component
    let inst: any = null;
    const fallback = (why: string) => {
      w.__dcErrors.push(why);
      isStatic = true;
      inst = null;
      schedule = () => undefined;
      paint();
      w.__dcMode = 'static';
      w.__dcReady = true;
    };
    if (!isStatic) {
      try {
        const code = scriptEl?.textContent ?? '';
        const Component = new Function(
          'DCLogic',
          'React',
          `${code}\n;return typeof Component !== 'undefined' ? Component : null;`,
        )(DCLogic, w.React);
        if (!Component) return fallback('no `class Component` in the handoff script');
        inst = new Component(props);
        inst.props = props;
        let queued = false;
        let renders = 0;
        const render = () => {
          vals = inst.renderVals();
          paint();
        };
        schedule = () => {
          if (queued) return;
          queued = true;
          queueMicrotask(() => {
            queued = false;
            if (++renders > 200) return fallback('the component re-rendered more than 200 times; stopped');
            try {
              render();
            } catch (e) {
              fallback(`renderVals threw on update: ${(e as Error).message}`);
            }
          });
        };
        render();
        inst.componentDidMount?.();
        w.__dcMode = 'runtime';
        // Components measure themselves on mount and again a few hundred ms later.
        setTimeout(() => {
          w.__dcReady = true;
        }, 600);
      } catch (e) {
        fallback(`the handoff's logic could not run: ${(e as Error).message}`);
      }
    } else {
      paint();
      w.__dcMode = 'static';
      w.__dcReady = true;
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
