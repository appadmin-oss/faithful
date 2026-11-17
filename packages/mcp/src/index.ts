/**
 * Faithful as an MCP server. Five tools, each a thin shell over the same function the CLI
 * calls, so an agent gets the same answer whichever door it uses.
 *
 * Token budget is the design constraint here as everywhere: every tool's text is the compact
 * report (one line when clean), the structured result carries the same content for a client
 * that parses, and the full detail stays on disk for `faithful_explain` to pull on demand.
 * Tool descriptions are short on purpose — they are paid for on every turn of every session
 * that has the server attached, whether or not a tool is called.
 *
 * There is deliberately no tool to rewrite the guard baseline. The baseline is a decision a
 * team reviews in a diff; a verifier the agent can quietly loosen is no verifier.
 */

import {
  audit,
  FaithfulError,
  formatGuard,
  guard,
  lastRun,
  loadConfig,
  OUT_DIR,
  outlineAny,
  verify,
} from '@faithful/cli';
import { explain, formatCompact, formatText } from '@faithful/core';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

export const VERSION = '0.1.0';

type Text = { content: { type: 'text'; text: string }[]; isError?: boolean };

const text = (t: string): Text => ({ content: [{ type: 'text', text: t }] });

/** An expected failure (bad path, unknown format) is a tool result the agent can act on, not a crash. */
async function guarded<T extends Text>(fn: () => Promise<T>): Promise<T | Text> {
  try {
    return await fn();
  } catch (e) {
    const msg =
      e instanceof FaithfulError ? e.message : `faithful failed: ${e instanceof Error ? e.message : String(e)}`;
    return { ...text(msg), isError: true };
  }
}

export function createServer(cwd = process.cwd()): McpServer {
  const server = new McpServer({ name: 'faithful', version: VERSION }, { capabilities: { tools: {} } });

  server.registerTool(
    'faithful_verify',
    {
      title: 'Verify a build against its design',
      description:
        'Compare a built page (URL or HTML file) with its design (Claude Design .dc.html, HTML, Figma JSON, tokens, DESIGN.md, copy deck). Returns PASS/FAIL, counts and the worst findings with one fix each. Re-run after fixing until PASS.',
      inputSchema: z.object({
        design: z.string().describe('Design file path'),
        build: z.string().describe('Build URL or HTML file path'),
        viewports: z.string().optional().describe('e.g. "1440x900,390x844"; default: the design\'s own'),
        also: z
          .array(z.string())
          .optional()
          .describe('Extra sources checked for conformity: tokens, copy deck, DESIGN.md'),
        max: z.number().int().min(1).max(50).optional().describe('Findings listed (default 8)'),
      }),
      outputSchema: z
        .object({
          pass: z.boolean(),
          score: z.number(),
          counts: z.object({ error: z.number(), warn: z.number(), info: z.number() }),
          top: z.array(z.record(z.string(), z.unknown())),
          more: z.number(),
        })
        .passthrough(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ design, build, viewports, also, max }) =>
      guarded(async () => {
        const run = await verify({
          design,
          build,
          cwd,
          config: await loadConfig(cwd),
          ...(viewports ? { viewports } : {}),
          ...(also?.length ? { also } : {}),
        });
        return {
          ...text(formatText(run, max ?? 8, `${OUT_DIR}/last.json`)),
          structuredContent: formatCompact(run, max ?? 8),
        };
      }),
  );

  server.registerTool(
    'faithful_audit',
    {
      title: 'Audit a page with no design',
      description:
        'Judge a page (URL or HTML file) on its own at phone and desktop width: clipped/overlapping text, sideways scroll, broken images, unrendered values, readability, wording, AI-slop tells.',
      inputSchema: z.object({
        target: z.string().describe('URL or HTML file path'),
        viewports: z.string().optional().describe('Default "375x812,1440x900"'),
        max: z.number().int().min(1).max(50).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ target, viewports, max }) =>
      guarded(async () => {
        const run = await audit({ target, cwd, config: await loadConfig(cwd), ...(viewports ? { viewports } : {}) });
        return {
          ...text(formatText(run, max ?? 8, `${OUT_DIR}/last.json`)),
          structuredContent: formatCompact(run, max ?? 8),
        };
      }),
  );

  server.registerTool(
    'faithful_outline',
    {
      title: 'Outline a design',
      description:
        'What a design (file or folder) contains — screens, sizes, palette, type scale, copy — in a few lines. Read before building.',
      inputSchema: z.object({
        design: z.string().describe('Design file or folder path'),
        viewports: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ design, viewports }) =>
      guarded(async () => text(await outlineAny(design, await loadConfig(cwd), viewports))),
  );

  server.registerTool(
    'faithful_explain',
    {
      title: 'Explain a finding',
      description: 'Full detail of a finding from the last verify (e.g. "F3"), or "all".',
      inputSchema: z.object({ finding: z.string().default('all') }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ finding }) => guarded(async () => text(explain(await lastRun(cwd), finding === 'all' ? 'all' : finding))),
  );

  server.registerTool(
    'faithful_guard',
    {
      title: 'Check source for design-system drift',
      description:
        'Scan source for raw colours, off-scale type, !important and similar drift. Fails only on files that got worse than the committed baseline.',
      inputSchema: z.object({
        files: z.array(z.string()).optional().describe('Default: the configured source folders'),
      }),
      outputSchema: z.object({ pass: z.boolean(), files: z.number(), regressions: z.number() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ files }) =>
      guarded(async () => {
        const r = await guard({ cwd, config: await loadConfig(cwd), ...(files?.length ? { files } : {}) });
        const g = formatGuard(r);
        return {
          ...text(g.text),
          structuredContent: { pass: g.pass, files: r.files, regressions: r.regressions.length },
        };
      }),
  );

  return server;
}
