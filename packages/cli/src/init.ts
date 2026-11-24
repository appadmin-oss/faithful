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
 * Every command is spelled `npx @usefaithful/cli`, never `npx faithful`: the unscoped name on npm
 * is somebody else's package, so in a project without Faithful installed the short form
 * downloads and runs a stranger's code.
 *
 * Every write is additive: an existing config is kept, an existing skill that differs from the
 * shipped one (a team's edits) is kept, and the AGENTS.md block is replaced between its own
 * markers, never duplicated.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '@usefaithful/core';

/**
 * The skills Faithful ships, read from `packages/cli/skills/<name>/SKILL.md` — the one copy,
 * browsable on GitHub, installed by `init`. Each teaches one job and ends in the command that
 * proves it was done.
 */
const SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url));
export const SKILLS: Record<string, string> = Object.fromEntries(
  readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SKILLS_DIR, d.name, 'SKILL.md')))
    .map((d) => [d.name, readFileSync(join(SKILLS_DIR, d.name, 'SKILL.md'), 'utf8')]),
);
/** The core skill: how to run Faithful. */
export const SKILL = SKILLS.faithful as string;

export const AGENTS_BLOCK = `<!-- faithful:begin -->
## Design fidelity (Faithful)
- Building UI from a design: run \`npx @usefaithful/cli outline <design>\` first, then \`npx @usefaithful/cli verify <design> --build <url>\` after each screen until it prints PASS; paste that line as proof.
- Before committing UI: \`npx @usefaithful/cli guard\`. Never loosen faithful.config.json or faithful.baseline.json to pass.
- Refactoring or redesigning working UI: \`npx @usefaithful/cli parity --before <old> --after <new>\` after every step; nothing may be lost.
- Upgrades meant to change nothing (Tailwind, React, a UI library): \`npx @usefaithful/cli verify <old-url> --build <new-url>\` per page; every difference is a finding.
- Skills in .agents/skills/ — read the one that fits before starting: faithful-implement-design (build from a design), faithful-ui-quality (no design), faithful-ui-states (loading/empty/error), faithful-responsive (mobile, every width), faithful-accessible-forms (forms, keyboard, a11y), faithful-dark-mode (dark theme, contrast), faithful-i18n (translation, RTL, text spacing), faithful-data-display (dashboards, tables), faithful-design-tokens (use the design system), faithful-no-visual-change (upgrades, migrations), faithful-safe-redesign (refactor/redesign), faithful-ui-copy (wording), faithful-design-handoff (design agents).
<!-- faithful:end -->`;

export async function init(cwd = process.cwd(), only?: string[]): Promise<string[]> {
  const done: string[] = [];
  const cfgPath = resolve(cwd, 'faithful.config.json');
  if (!existsSync(cfgPath)) {
    await writeFile(cfgPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
    done.push('wrote faithful.config.json');
  } else done.push('kept faithful.config.json');

  const names = only?.length ? only : Object.keys(SKILLS);
  const wrote: string[] = [];
  const kept: string[] = [];
  for (const name of names) {
    const body = SKILLS[name];
    if (!Object.hasOwn(SKILLS, name) || !body)
      throw new Error(`no skill "${name}"; there are: ${Object.keys(SKILLS).join(', ')}`);
    const skillPath = resolve(cwd, `.agents/skills/${name}/SKILL.md`);
    if (existsSync(skillPath)) {
      if ((await readFile(skillPath, 'utf8')) !== body) kept.push(name);
      continue;
    }
    await mkdir(dirname(skillPath), { recursive: true });
    await writeFile(skillPath, body);
    wrote.push(name);
  }
  if (wrote.length)
    done.push(`wrote ${wrote.length} skill${wrote.length === 1 ? '' : 's'} to .agents/skills/: ${wrote.join(', ')}`);
  if (!wrote.length && !kept.length) done.push('skills in .agents/skills/ are current');
  if (kept.length)
    done.push(
      `kept ${kept.length} edited skill${kept.length === 1 ? '' : 's'} in .agents/skills/ (differs from the shipped one; delete it to update): ${kept.join(', ')}`,
    );

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
