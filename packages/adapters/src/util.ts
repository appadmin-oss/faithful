import type { FaithfulSpec, Inventory, Provenance, Tier } from '@usefaithful/spec';
import { SPEC_VERSION } from '@usefaithful/spec';

export const VERSION = '0.1.0';

export function provenance(
  adapter: string,
  format: string,
  tier: Tier,
  confidence: number,
  source: string,
  warnings: string[] = [],
): Provenance {
  return { adapter, adapterVersion: VERSION, format, tier, confidence, source, warnings };
}

export function spec(
  p: Provenance,
  screens: FaithfulSpec['screens'],
  extra: Partial<Pick<FaithfulSpec, 'tokens' | 'inventory' | 'extensions'>> = {},
): FaithfulSpec {
  const s: FaithfulSpec = { faithful: SPEC_VERSION, provenance: p, screens };
  if (extra.tokens) s.tokens = extra.tokens;
  if (extra.inventory) s.inventory = extra.inventory;
  if (extra.extensions) s.extensions = extra.extensions;
  return s;
}

export const ext = (path: string): string => {
  const m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(path.replace(/\.dc\.html$/i, '.dchtml'));
  return m ? (m[1] as string).toLowerCase() : '';
};

/** A screen id from a file name: `member-portal-v10.dc.html` → `member-portal-v10`. */
export const screenId = (path: string): string =>
  (path.split(/[\\/]/).pop() ?? 'screen').replace(/\.(dc\.html|html?|json|png|jpe?g|webp|svg|md)$/i, '') || 'screen';

/** Merge inventories, de-duplicated. */
export function mergeInventory(a: Inventory, b: Partial<Inventory>): Inventory {
  const u = <T>(x: T[], y: T[] = []) => [...new Set([...x, ...y])];
  return {
    colors: u(a.colors, b.colors),
    fontSizes: u(a.fontSizes, b.fontSizes).sort((x, y) => x - y),
    fontFamilies: u(a.fontFamilies, b.fontFamilies),
    radii: u(a.radii, b.radii),
    texts: u(a.texts, b.texts),
  };
}
