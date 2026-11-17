/**
 * `faithful init`: the three files that make an agent use Faithful without being told.
 *
 *   faithful.config.json             the tolerances and guards, with defaults written out
 *   .agents/skills/faithful/SKILL.md the Agent Skill (read by Claude Code, Codex, Cursor,
 *                                    Copilot, Gemini CLI, Windsurf…), under 100 lines
 *   AGENTS.md                        a five-line block, because a skill does not always load
 *                                    itself (Vercel's evals: skills were not invoked in 56%
 *                                    of cases; a short AGENTS.md pointer was followed)
 *
 * Every command is spelled `npx @faithful/cli`, never `npx faithful`: the unscoped name on npm
 * is somebody else's package, so in a project without Faithful installed the short form
 * downloads and runs a stranger's code.
 *
 * Every write is additive: an existing config is kept, and the AGENTS.md block is replaced
 * between its own markers, never duplicated.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DEFAULT_CONFIG } from '@faithful/core';

export const SKILL = `---
name: faithful
description: Prove a UI build matches its design before calling it done. Use when implementing or reviewing a screen from a design handoff, Claude Design .dc.html, Figma export, HTML prototype, mockup, screenshot, DESIGN.md or design tokens; when asked if a page "matches the design", is "pixel-perfect" or "faithful"; and before reporting UI work complete.
---

# Faithful: build to the design, then prove it

A design is a specification. Every colour, size, radius, string and state in it was decided.

## Before building

1. \`npx @faithful/cli outline <design>\` — screens, copy, palette and type scale in a few lines.
   For a handoff folder: \`npx @faithful/cli outline <folder>\` lists which files are designs.
2. Put the design's tokens in the project's theme first. No colour or size is typed anywhere else.
3. Copy is final. Use the design's strings exactly.

## After each screen

\`\`\`
npx @faithful/cli verify <design> --build <url-or-file> [--viewports 1440x900,390x844]
\`\`\`

- The output is a verdict line and the worst findings, each with one fix. Fix errors (E) first.
- \`npx @faithful/cli explain F3\` for one finding; \`--all\` for every one. Full JSON: .faithful/last.json.
- Re-run until it prints \`faithful PASS\`. Paste that line in your report as proof.
- "(indicative)" means the design could not be placed (tokens, a copy deck, an image without a
  sidecar): say so in your report rather than claiming a match.

## A page with no design (or before calling any UI done)

\`npx @faithful/cli audit <url-or-file>\` — at phone and desktop width: text cut off or drawn
over text, sideways scroll, broken images, \`undefined\` on the page, readability, vague link
and button wording, and the tells of generated UI. Fix every E; treat "reads as generated" as
a design problem to solve, not a style to keep.

## Refactoring or redesigning something that already works

Record the BEFORE build first (a URL, or the built HTML), then after every step:
\`npx @faithful/cli parity --before <old> --after <new>\` — every link, button, form field,
landmark and route must still be there; looks are ignored. "renamed" needs your confirmation;
"lost" and "changed" mean users can no longer do something they could. Improve freely — a
redesign should be better than the design or code it replaces — but never drop a function
silently.

## Before committing

\`npx @faithful/cli guard\` — no new !important, raw colours or off-scale type. Existing debt is in
faithful.baseline.json and may only shrink. Never edit the baseline or faithful.config.json to
make a check pass; if a rule is wrong for this project, say so and ask.

With the Faithful MCP server attached, \`faithful_outline\`, \`faithful_verify\`,
\`faithful_audit\`, \`faithful_parity\`, \`faithful_explain\` and \`faithful_guard\` do the same and return the same lines.

## Design agents

Ship a spec beside your prototype so builders can verify against it:
\`npx @faithful/cli spec <prototype.html> --out <name>.faithful.json\`
`;

export const AGENTS_BLOCK = `<!-- faithful:begin -->
## Design fidelity (Faithful)
- Building UI from a design: run \`npx @faithful/cli outline <design>\` first, then \`npx @faithful/cli verify <design> --build <url>\` after each screen until it prints PASS; paste that line as proof.
- Before committing UI: \`npx @faithful/cli guard\`. Never loosen faithful.config.json or faithful.baseline.json to pass.
- Details: .agents/skills/faithful/SKILL.md
<!-- faithful:end -->`;

export async function init(cwd = process.cwd()): Promise<string[]> {
  const done: string[] = [];
  const cfgPath = resolve(cwd, 'faithful.config.json');
  if (!existsSync(cfgPath)) {
    await writeFile(cfgPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
    done.push('wrote faithful.config.json');
  } else done.push('kept faithful.config.json');

  const skillPath = resolve(cwd, '.agents/skills/faithful/SKILL.md');
  await mkdir(dirname(skillPath), { recursive: true });
  await writeFile(skillPath, SKILL);
  done.push('wrote .agents/skills/faithful/SKILL.md');

  const agentsPath = resolve(cwd, 'AGENTS.md');
  const before = existsSync(agentsPath) ? await readFile(agentsPath, 'utf8') : '';
  const re = /<!-- faithful:begin -->[\s\S]*?<!-- faithful:end -->/;
  const after = re.test(before)
    ? before.replace(re, AGENTS_BLOCK)
    : `${before}${before && !before.endsWith('\n') ? '\n' : ''}${before ? '\n' : ''}${AGENTS_BLOCK}\n`;
  await writeFile(agentsPath, after);
  done.push(before ? 'updated AGENTS.md' : 'wrote AGENTS.md');

  // Claude Code reads CLAUDE.md and ignores AGENTS.md beside it, unless CLAUDE.md imports it.
  const claudePath = resolve(cwd, 'CLAUDE.md');
  if (existsSync(claudePath)) {
    const c = await readFile(claudePath, 'utf8');
    if (!/@AGENTS\.md/.test(c)) {
      await writeFile(claudePath, `${c}${c.endsWith('\n') ? '' : '\n'}\n@AGENTS.md\n`);
      done.push('CLAUDE.md now imports @AGENTS.md');
    }
  }
  return done;
}
