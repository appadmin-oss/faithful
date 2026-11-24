/**
 * Claude Design handoffs: `.dc.html` — a template inside `<x-dc>` driven by a
 * `class Component extends DCLogic` and a `support.js` runtime the file expects beside it.
 *
 * Three ways to read one, best first, and the report says which was used:
 *
 *   support.js present   the file renders as its designer saw it (tier `rendered`, 0.9)
 *   Faithful's runtime   the component's own logic, mounted by dcRuntime (`rendered`, 0.8)
 *   static               the logic could not run (data scripts missing, an error): the
 *                        template with its own preview hints, every data hole marked and
 *                        dropped, so the literal copy and literal styles are read and nothing
 *                        invented is (`static`, 0.5)
 *
 * A handoff routinely arrives without support.js and without its data scripts — every one in
 * the nextgengen repository does — so the second and third paths are the normal case, not
 * the fallback.
 */

import { dirname, join } from 'node:path';
import type { Adapter, Rendered } from '@usefaithful/core';
import type { DesignElement, Screen } from '@usefaithful/spec';
import { dcRuntime } from './dc-runtime.js';
import { provenance, screenId, spec } from './util.js';

/** The marker the static path writes into every data hole. Never real copy. */
export const HOLE = '⟦⟧';

interface Probe {
  mode?: string;
  errors?: string[];
}

/** Scripts the handoff loads by relative path (data, media) that are not beside it. */
export async function missingScripts(
  html: string,
  dir: string,
  exists: (p: string) => Promise<boolean>,
): Promise<string[]> {
  const out: string[] = [];
  // `./data.js`, `data.js` or 'data.js', with or without `?v=2`; not `/x.js`, `//cdn/x.js` or `https:`.
  for (const m of html.matchAll(/<script\b[^>]*?\ssrc\s*=\s*(["'])(.*?)\1/gi)) {
    const src = (m[2] as string).trim().replace(/[?#].*$/, '');
    if (!src || src.startsWith('/') || /^[a-z][\w+.-]*:/i.test(src)) continue;
    if (/(^|\/)support\.js$/.test(src)) continue;
    if (!(await exists(join(dir, src)))) out.push(src.replace(/^\.\//, ''));
  }
  return [...new Set(out)];
}

/** Drop what a data hole put on the page: a text that was a hole is not design copy. */
export function scrubHoles(screen: Screen): { screen: Screen; dropped: number } {
  let dropped = 0;
  const elements: DesignElement[] = [];
  for (const e of screen.elements) {
    if (e.text?.includes(HOLE)) {
      const literal = e.text.split(HOLE).join(' ').replace(/\s+/g, ' ').trim();
      dropped++;
      // Literal words around a hole ("{{ n }} students") are kept only when they are most of
      // the text; a lone "students" is not a design string anybody wrote on its own.
      if (e.kind === 'text') continue;
      const { text: _t, ...rest } = e;
      elements.push(
        literal.length > 3 && literal.length >= (e.text.length - HOLE.length) * 0.8 ? { ...rest, text: literal } : rest,
      );
      continue;
    }
    elements.push(e);
  }
  return { screen: { ...screen, elements }, dropped };
}

/**
 * The site a handoff belongs to: the nearest folder above it that holds the root-absolute
 * assets it names (`/assets/logo.png`). A handoff in `docs/design/site/` of a repository
 * points at the repository's `/assets`, and without this every image is a 404.
 */
export async function findSiteRoot(
  html: string,
  dir: string,
  exists: (p: string) => Promise<boolean>,
): Promise<string | undefined> {
  const paths = [...html.matchAll(/(?:src|href)="(\/(?!\/)[^"?#]+\.(?:png|jpe?g|webp|gif|svg|css|js|woff2?|mp4))"/gi)]
    .map((m) => m[1] as string)
    .slice(0, 12);
  if (!paths.length) return undefined;
  let d = dir;
  for (let i = 0; i < 7; i++) {
    let hits = 0;
    for (const p of paths) if (await exists(join(d, p))) hits++;
    if (hits >= Math.max(1, Math.ceil(paths.length / 3))) return d;
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return undefined;
}

export const dcHtmlAdapter: Adapter = {
  name: 'dc-html',
  version: '0.1.0',
  describes: 'Claude Design handoffs (.dc.html), with or without support.js and their data scripts',
  sniff(input) {
    if (input.isUrl) return null;
    const isDc = /<x-dc[\s>]/i.test(input.head);
    if (!isDc) return null;
    const hasLogic = /extends\s+DCLogic/.test(input.head) || /data-dc-script/.test(input.head);
    return { format: 'claude-design/dc@1', confidence: hasLogic ? 0.97 : 0.9 };
  },
  async read(input, ctx) {
    const html = await ctx.readFile(input.path);
    const dir = dirname(input.path);
    const warnings: string[] = [];
    const missing = await missingScripts(html, dir, ctx.exists);
    if (missing.length) warnings.push(`data scripts not beside the handoff: ${missing.join(', ')}`);
    const hasSupport = await ctx.exists(join(dir, 'support.js'));
    const siteRoot = await findSiteRoot(html, dir, ctx.exists);
    if (!siteRoot && /(?:src|href)="\/(?!\/)/.test(html))
      warnings.push('root-absolute assets (/assets/…) not found above the handoff; images may be missing');
    const id = screenId(input.path);
    const screens: Screen[] = [];
    let tier: 'rendered' | 'static' = 'rendered';
    let confidence = hasSupport ? 0.9 : 0.8;
    let mode = hasSupport ? 'support.js' : 'runtime';

    for (const vp of ctx.viewports) {
      const sid = `${id}@${vp.width}`;
      if (hasSupport) {
        screens.push(
          await ctx.render(
            { html, baseDir: dir, ...(siteRoot ? { siteRoot } : {}), readyWhen: 'document.readyState === "complete"' },
            vp,
            sid,
          ),
        );
        continue;
      }
      const run = (m: 'auto' | 'static') =>
        ctx.render(
          {
            html,
            baseDir: dir,
            ...(siteRoot ? { siteRoot } : {}),
            initScript: `(${dcRuntime.toString()})(${JSON.stringify({ mode: m, hole: HOLE })});`,
            readyWhen: 'window.__dcReady === true',
            probe: '({ mode: window.__dcMode, errors: window.__dcErrors })',
          },
          vp,
          sid,
        );
      let r: Rendered = await run('auto');
      const probe = (r.probe ?? {}) as Probe;
      for (const e of probe.errors ?? []) if (!warnings.includes(e)) warnings.push(e);
      if (probe.mode === 'static') {
        tier = 'static';
        confidence = 0.5;
        mode = 'static';
      } else if (probe.mode !== 'runtime') {
        // The runtime never reported (a script error before boot): read it statically.
        r = await run('static');
        tier = 'static';
        confidence = 0.5;
        mode = 'static';
      }
      const { screen, dropped } = scrubHoles(r);
      if (dropped && mode === 'static')
        warnings.push(`${dropped} data-bound texts left out of ${sid} (no data to fill them)`);
      screens.push(screen);
    }
    return spec(provenance('dc-html', 'claude-design/dc@1', tier, confidence, input.path, warnings), screens, {
      extensions: { 'faithful.dc': { mode } },
    });
  },
};
