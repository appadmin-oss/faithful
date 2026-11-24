/**
 * Any page a browser can draw: an HTML prototype on disk, a dev server, a deployed URL, a
 * Storybook story. The browser IS the reader — it alone knows what the cascade decided.
 */

import { dirname } from 'node:path';
import type { Adapter } from '@usefaithful/core';
import { provenance, screenId, spec } from './util.js';

export const htmlAdapter: Adapter = {
  name: 'html',
  version: '0.1.0',
  describes: 'HTML prototypes, dev servers and live URLs (rendered in Chromium)',
  sniff(input) {
    if (input.isUrl) return { format: 'web/url', confidence: 0.6 };
    if (/\.html?$/i.test(input.path) && !/\.dc\.html$/i.test(input.path)) {
      // A Claude Design template is HTML too; leave it to the reader that understands it.
      if (/<x-dc[\s>]/i.test(input.head)) return null;
      return { format: 'web/html', confidence: 0.6 };
    }
    return null;
  },
  async read(input, ctx) {
    const screens = [];
    const target = input.isUrl
      ? { url: input.path }
      : { html: await ctx.readFile(input.path), baseDir: dirname(input.path) };
    for (const vp of ctx.viewports) {
      screens.push(await ctx.render(target, vp, `${screenId(input.path)}@${vp.width}`));
    }
    return spec(provenance('html', input.isUrl ? 'web/url' : 'web/html', 'rendered', 0.9, input.path), screens);
  },
};
