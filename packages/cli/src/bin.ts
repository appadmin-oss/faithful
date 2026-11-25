#!/usr/bin/env node
/**
 * `faithful` — the command line. Output is written for an agent's context window: a verdict
 * line, the worst findings with one fix each, and a path to the rest. Exit codes: 0 pass,
 * 1 fail (findings), 2 could not run (bad input, no browser).
 */
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ADAPTERS } from '@usefaithful/adapters';
import { chromeCandidates, findChrome } from '@usefaithful/browser';
import {
  compareScreens,
  DEFAULT_CONFIG,
  explain,
  formatCompact,
  formatText,
  RULES,
  selftestRules,
} from '@usefaithful/core';
import {
  audit,
  FaithfulError,
  formatGuard,
  guard,
  lastRun,
  loadConfig,
  OUT_DIR,
  outlineAny,
  parity,
  parseMax,
  parseViewports,
  readDesign,
  Session,
  verify,
  verifyChecks,
} from './api.js';
import { init } from './init.js';

const HELP = `faithful — prove a build matches its design

  faithful verify                          every page in faithful.config.json "checks", one verdict
  faithful verify <design> --build <url|file> [--scroll 0,900] [--physics] [--screen <id>] [--viewports 1440x900,390x844] [--also <tokens|copy|DESIGN.md>…] [--color-scheme light|dark] [--format text|json] [--max 8]
  faithful audit <url|file> [--viewports …] [--color-scheme light|dark|both]  judge a page with no design: layout faults, contrast, WCAG (axe-core), readability, AI-slop tells
      [--stress zoom,reflow,expand,rtl,spacing|none]  extra passes: text at 200%, 320px wide (both by default),
                                           text 1.3–2× longer, right-to-left, WCAG text spacing
      [--no-axe]                           skip axe-core's WCAG 2.2 A/AA rules (or config audit.axe: false)
  faithful parity --before <a> --after <b>  after a refactor or redesign: can users still do everything they could?
  faithful outline <design|folder>         what a design contains, in a few lines
  faithful spec <design> [--out file]      the design as a Faithful spec (for design agents to ship)
  faithful explain [F3|--all]              detail of a finding from the last run
  faithful guard [files…] [--update-baseline]   source rules: no !important, raw colours, off-scale type
  faithful selftest                        prove every rule and the comparison can see a planted fault
  faithful formats                         the design formats Faithful reads
  faithful doctor                          check the browser and environment
  faithful init [--skills a,b]              write faithful.config.json, the agent skills and an AGENTS.md block

Designs: Claude Design .dc.html and canvas.json (one screen per board: --screen <id>) and
design-system tokens.json, HTML (file or URL), Figma REST JSON, DTCG tokens, CSS custom
properties, Tailwind @theme, DESIGN.md, copy decks (.txt), images (+ .faithful.json sidecar).
Docs: https://github.com/appadmin-oss/faithful`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values: v, positionals: pos } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      build: { type: 'string', short: 'b' },
      before: { type: 'string' },
      after: { type: 'string' },
      pages: { type: 'string' },
      skills: { type: 'string' },
      viewports: { type: 'string', short: 'v' },
      'color-scheme': { type: 'string' },
      stress: { type: 'string' },
      screen: { type: 'string' },
      scroll: { type: 'string' },
      physics: { type: 'boolean', default: false },
      also: { type: 'string', multiple: true },
      format: { type: 'string', short: 'f', default: 'text' },
      max: { type: 'string', default: '' },
      out: { type: 'string', short: 'o' },
      config: { type: 'string', short: 'c' },
      all: { type: 'boolean', default: false },
      'update-baseline': { type: 'boolean', default: false },
      'no-axe': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h' || v.help) {
    console.log(HELP);
    return 0;
  }
  const cfg = await loadConfig(process.cwd(), v.config);
  const max = parseMax(v.max, cfg.maxFindings);

  switch (cmd) {
    case 'verify': {
      const design = pos[0];
      if (!design && !v.build) {
        // No design: every page listed in faithful.config.json "checks".
        const run = await verifyChecks({ config: cfg });
        console.log(
          v.format === 'json' ? JSON.stringify(formatCompact(run, max)) : formatText(run, max, `${OUT_DIR}/last.json`),
        );
        return run.pass ? 0 : 1;
      }
      if (!design || !v.build) throw new FaithfulError('usage: faithful verify <design> --build <url|file>');
      const opts: Parameters<typeof verify>[0] = { design, build: v.build, config: cfg };
      if (v.viewports) opts.viewports = v.viewports;
      if (v.also?.length) opts.also = v.also;
      if (v['color-scheme'] !== undefined) opts.colorScheme = v['color-scheme'];
      if (v.screen !== undefined) opts.screen = v.screen;
      if (v.scroll !== undefined) opts.scroll = v.scroll;
      if (v.physics) opts.physics = true;
      const run = await verify(opts);
      console.log(
        v.format === 'json' ? JSON.stringify(formatCompact(run, max)) : formatText(run, max, `${OUT_DIR}/last.json`),
      );
      return run.pass ? 0 : 1;
    }
    case 'audit': {
      const target = pos[0];
      if (!target) throw new FaithfulError('usage: faithful audit <url|file> [--viewports 375x812,1440x900]');
      const run = await audit({
        target,
        config: cfg,
        ...(v.viewports ? { viewports: v.viewports } : {}),
        ...(v['color-scheme'] !== undefined ? { colorScheme: v['color-scheme'] } : {}),
        ...(v.stress !== undefined ? { stress: v.stress } : {}),
        ...(v['no-axe'] ? { axe: false } : {}),
      });
      console.log(
        v.format === 'json' ? JSON.stringify(formatCompact(run, max)) : formatText(run, max, `${OUT_DIR}/last.json`),
      );
      return run.pass ? 0 : 1;
    }
    case 'parity': {
      const before = v.before ?? pos[0];
      const after = v.after ?? pos[1];
      if (!before || !after)
        throw new FaithfulError('usage: faithful parity --before <url|file> --after <url|file> [--pages /,/pricing]');
      const run = await parity({
        before,
        after,
        config: cfg,
        ...(v.viewports ? { viewports: v.viewports } : {}),
        ...(v.pages ? { pages: v.pages.split(',').map((p) => p.trim()) } : {}),
      });
      console.log(
        v.format === 'json' ? JSON.stringify(formatCompact(run, max)) : formatText(run, max, `${OUT_DIR}/last.json`),
      );
      return run.pass ? 0 : 1;
    }
    case 'outline': {
      const target = pos[0];
      if (!target) throw new FaithfulError('usage: faithful outline <design|folder>');
      console.log(await outlineAny(target, cfg, v.viewports));
      return 0;
    }
    case 'spec': {
      const target = pos[0];
      if (!target) throw new FaithfulError('usage: faithful spec <design> [--out file]');
      const s = new Session(cfg);
      try {
        const spec = await readDesign(target, s, parseViewports(v.viewports, cfg.viewports));
        const json = JSON.stringify(spec, null, 1);
        if (v.out) {
          await writeFile(v.out, json);
          console.log(
            `wrote ${v.out}: ${spec.screens.length} screens, ${spec.screens.reduce((n, x) => n + x.elements.length, 0)} elements`,
          );
        } else console.log(json);
      } finally {
        await s.close();
      }
      return 0;
    }
    case 'explain': {
      const run = await lastRun();
      console.log(explain(run, v.all ? 'all' : (pos[0] ?? 'all')));
      return 0;
    }
    case 'guard': {
      const r = await guard({ files: pos, updateBaseline: v['update-baseline'], config: cfg });
      const g = formatGuard(r, max, !!v['update-baseline']);
      console.log(g.text);
      return g.pass ? 0 : 1;
    }
    case 'selftest': {
      const failures = selftestRules(cfg.guards);
      // The comparison itself must see a planted fault: a design compared with a copy whose
      // heading moved, changed colour and changed copy.
      const vp = { width: 800, height: 600 };
      const d = {
        id: 'd',
        name: 'd',
        viewport: vp,
        elements: [
          {
            id: 'h',
            kind: 'text' as const,
            text: 'Choose your plan',
            box: { x: 20, y: 20, w: 300, h: 40 },
            style: { color: '#10292c', fontSize: 32 },
          },
          {
            id: 'p',
            kind: 'text' as const,
            text: 'Cancel any time',
            box: { x: 20, y: 80, w: 200, h: 24 },
            style: { color: '#10292c', fontSize: 16 },
          },
        ],
      };
      const b = {
        ...d,
        elements: [
          { ...d.elements[0], text: 'Choose a plan', style: { color: '#2a6f2a', fontSize: 28 } },
          { ...d.elements[1], box: { x: 120, y: 80, w: 200, h: 24 } },
        ],
      } as typeof d;
      const kinds = new Set(compareScreens(d, b, DEFAULT_CONFIG).findings.map((f) => f.kind));
      for (const k of ['text', 'color', 'font-size', 'position'])
        if (!kinds.has(k as never)) failures.push(`the comparison missed a planted ${k} fault`);
      if (compareScreens(d, d, DEFAULT_CONFIG).findings.length)
        failures.push('the comparison reported faults in a design compared with itself');
      console.log(
        failures.length
          ? `selftest FAIL\n${failures.join('\n')}`
          : `selftest PASS · ${RULES.length} guard rules and the comparison each caught their planted faults`,
      );
      return failures.length ? 1 : 0;
    }
    case 'formats': {
      for (const a of ADAPTERS) console.log(`${a.name.padEnd(14)} ${a.describes}`);
      return 0;
    }
    case 'doctor': {
      const exe = findChrome();
      console.log(`node ${process.version}`);
      console.log(
        exe
          ? `browser: ${exe}`
          : `browser: none found. Run \`npx playwright install chromium --only-shell\`, or set FAITHFUL_CHROMIUM. Looked in:\n  ${chromeCandidates().slice(0, 8).join('\n  ')}`,
      );
      return exe ? 0 : 2;
    }
    case 'init': {
      for (const line of await init(process.cwd(), v.skills ? v.skills.split(',').map((x) => x.trim()) : undefined))
        console.log(line);
      return 0;
    }
    default:
      throw new FaithfulError(`unknown command "${cmd}". Run \`faithful help\`.`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`faithful: ${msg}`);
    process.exitCode = 2;
  },
);
