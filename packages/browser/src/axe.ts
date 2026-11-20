/**
 * axe-core inside `faithful audit`: the WCAG 2.2 A/AA rules a specialist has spent years on,
 * run in the same isolated world as Faithful's own probe, so a page cannot tamper with it.
 * The bundled `axe.min.js` is evaluated as a script there, then run with only the WCAG tags
 * (`wcag22aa` switches on `target-size`); its results are trimmed in the page to what a
 * finding needs, since the full nodes list of a large page is megabytes.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { AxeRule } from '@faithful/core';

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

let source: string | undefined;
/** The bundled axe-core build, read once per process. */
export function axeSource(): string {
  source ??= readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  return source;
}

/**
 * Runs in the page after axe's source; self-contained (serialised with `toString`). Frames are
 * not entered: axe would need injecting into each, and a frame that never answers stalls it.
 */
export function runAxe(tags: string[]): Promise<{ violations: AxeRule[]; incomplete: AxeRule[] }> {
  // biome-ignore lint/suspicious/noExplicitAny: axe is a global the source just defined.
  const axe = (globalThis as any).axe;
  if (!axe?.run) throw new Error('axe-core did not load');
  type Result = {
    id: string;
    impact: AxeRule['impact'];
    help: string;
    helpUrl: string;
    nodes: { target: unknown[] }[];
  };
  const trim = (rs: Result[]): AxeRule[] =>
    rs.map((r) => ({
      id: r.id,
      impact: r.impact ?? null,
      help: r.help,
      helpUrl: r.helpUrl,
      n: r.nodes.length,
      sel: String(r.nodes[0]?.target?.[0] ?? ''),
    }));
  return axe
    .run(document, {
      runOnly: { type: 'tag', values: tags },
      resultTypes: ['violations', 'incomplete'],
      iframes: false,
      elementRef: false,
      performanceTimer: false,
    })
    .then((r: { violations: Result[]; incomplete: Result[] }) => ({
      violations: trim(r.violations),
      incomplete: trim(r.incomplete),
    }));
}
