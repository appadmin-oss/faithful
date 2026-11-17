# What makes agentic-coding tools effective, and what Faithful takes from them

Studied 17 Nov 2026 from primary sources (papers, READMEs, official docs). Items not confirmed
at the source are marked unverified and are not relied on.

## Adopted

| # | Practice | Evidence | In Faithful |
|---|---|---|---|
| 1 | Concise feedback by default, detail on request | SWE-agent ablations (arXiv 2405.15793): summarised search 18.0% vs iterative 12.0%; a 100-line viewer 18.0% vs a full file 12.7%. Anthropic, *Writing tools for agents*: a `response_format` of concise/detailed, 72 vs 206 tokens | One verdict line, the top N findings, `+K more`; `--format json`; `explain` for detail |
| 2 | Big outputs go to files; return a path | Playwright MCP `--output-dir`; Claude Code hooks store over 10k characters in a file; MCP `resource_link` | Full result written to `.faithful/last.json`; the report prints the path |
| 3 | CLI plus skill first, MCP second | Playwright README ("CLI + SKILLs better suited for high-throughput coding agents"); Context7 `ctx7` CLI plus skill; Anthropic code-execution article (−98.7%) | `npx @faithful/cli verify` is primary; the MCP server wraps the same core |
| 4 | Few tools, one per workflow | Anthropic tool guide; GitHub MCP toolsets plus `--read-only`; Playwright `--caps` | Four MCP tools: outline, verify, explain, guard |
| 5 | Structure, not pixels | Playwright MCP accessibility snapshots; Framelink compresses Figma data about 90% | Elements with role, text, box and computed style; images only on request, never inline |
| 6 | Score like Design2Code | arXiv 2403.03163: Jonker-Volgenant matching, CIEDE2000; models mostly miss elements and layout | Missing and extra ranked first, then layout, then style |
| 7 | Errors say what to do next | Anthropic guide; MCP `isError` | Every finding kind has one fix sentence; reader warnings are listed |
| 8 | Check on edit | SWE-agent: edits with linting 18.0% vs 15.0% without; Claude Code PostToolUse exit 2 | `faithful guard <changed files>`; a PostToolUse hook recipe is planned |
| 9 | No "done" until it passes; ask for evidence | Claude Code best practices (Stop hook exit 2); obra/superpowers *verification-before-completion* | The skill asks for the verdict line as proof; a Stop-hook recipe is planned |
| 10 | Agent Skills spec | agentskills.io: name ≤64 characters, description ≤1024, body under 500 lines | `.agents/skills/faithful/SKILL.md`, held under 100 lines by a test |
| 11 | A short AGENTS.md pointer as well as the skill | Vercel's eval: a docs index in AGENTS.md reached 100% vs 79% for skills; skills were not invoked in 56% of cases | `faithful init` writes a block of about 5 lines into AGENTS.md |
| 12 | Formats agents already know | Aider: unified diffs raised GPT-4 Turbo from 20% to 61% | Compiler-style lines, `design → build` |
| 13 | A fixed token budget | Aider repo map `--map-tokens` | `--max N`; the report-size test holds a token ceiling |
| 14 | Evals with planted faults and a baseline | terminal-bench; `claude plugin eval`; Anthropic held-out sets | `selftest` (planted samples per rule); `fixtures/pricing` is a planted-fault pair; a larger `evals/` set is planned |
| 15 | Structured content plus text | MCP `outputSchema` / `structuredContent` | MCP verify returns both |

## Avoided

- **A verifier the agent can edit.** ImpossibleBench (arXiv 2510.20270); Cursor's reward-hacking report. The baseline is a committed file and no MCP tool can rewrite it; a hook recipe protecting it from edits is planned.
- **Dumping whole trees or screenshots.** It cost SWE-agent 5–6 points.
- **Opaque errors and tracebacks.**
- **Over-strict verifiers.** Tolerances are per property in `faithful.config.json`, and faults the design has too are notes, not errors.
- **Shouting, and "loop until done" prompts.** A rule that must always hold belongs in a hook.
- **Relying only on a skill loading itself.**
- **An oversized AGENTS.md.** Codex truncates it at 32 KiB.
- **A separate install per agent.**

## Launch models

- `microsoft/playwright-mcp` and `playwright-cli`
- `upstash/context7`
- `obra/superpowers`
- `SWE-agent/mini-swe-agent`
- Aider's benchmark harness
- `github/github-mcp-server`
- The Agent Skills spec plus `skills-ref`
