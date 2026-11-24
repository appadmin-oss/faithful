/**
 * The adapter contract. An adapter turns one kind of design source into a Faithful spec; it
 * never compares anything. Adding a format is one file that implements this — the verifier,
 * the guards, the CLI and the MCP tools do not change.
 *
 * `sniff` looks at the name and the first bytes and says how sure it is that it can read the
 * source. The registry asks every adapter and takes the most confident, so a `.html` file that
 * is really a Claude Design template goes to the reader that understands it, not to the
 * generic HTML one — by content, never by extension alone.
 */
import type { FaithfulSpec, Screen, Viewport } from '@usefaithful/spec';

export interface SourceInput {
  /** File path or URL, as given. */
  path: string;
  isUrl: boolean;
  /** First 64KB, for sniffing. Empty for a URL. */
  head: string;
}

export interface Sniff {
  /** e.g. `claude-design/dc@1`. */
  format: string;
  /** 0–1. */
  confidence: number;
}

export interface RenderTarget {
  url?: string;
  html?: string;
  /** Where relative URLs in `html` resolve from. */
  baseDir?: string;
  /** Where root-absolute URLs (`/assets/x.png`) resolve from: the site the design belongs to. */
  siteRoot?: string;
  /** Script to run before the page's own (a runtime shim). */
  initScript?: string;
  /** Wait for this JS expression to be truthy before capturing. */
  readyWhen?: string;
  /** A JS expression evaluated after capture; its JSON value comes back as `probe`. */
  probe?: string;
}

export type Rendered = Screen & { probe?: unknown };

export interface ReadContext {
  viewports: Viewport[];
  /** Render a page and extract its elements. Supplied by @usefaithful/browser. */
  render(target: RenderTarget, viewport: Viewport, screenId: string): Promise<Rendered>;
  readFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  warn(message: string): void;
}

export interface Adapter {
  name: string;
  version: string;
  /** Formats it reads, for `faithful formats`. */
  describes: string;
  sniff(input: SourceInput): Sniff | null;
  read(input: SourceInput, ctx: ReadContext): Promise<FaithfulSpec>;
}

export function pickAdapter(adapters: Adapter[], input: SourceInput): { adapter: Adapter; sniff: Sniff } | null {
  let best: { adapter: Adapter; sniff: Sniff } | null = null;
  for (const a of adapters) {
    let s: Sniff | null = null;
    try {
      s = a.sniff(input);
    } catch {
      s = null; // a reader that cannot even sniff is not the reader for this
    }
    if (s && s.confidence > 0 && (!best || s.confidence > best.sniff.confidence)) best = { adapter: a, sniff: s };
  }
  return best;
}
