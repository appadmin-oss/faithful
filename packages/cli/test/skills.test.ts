/**
 * The skills Faithful ships, held to the Agent Skills spec (agentskills.io) and to the rules
 * that make a skill worth loading: it names a Faithful command that proves the job was done,
 * it never sends anyone to the unscoped `npx faithful` (somebody else's package), and it stays
 * small — a skill's description is paid for in every session, its body on every load.
 */
import { describe, expect, it } from 'vitest';
import { SKILLS } from '../src/index.js';

describe('shipped skills', () => {
  it('there are fourteen, and the core one is among them', () => {
    expect(Object.keys(SKILLS).sort()).toEqual([
      'faithful',
      'faithful-accessible-forms',
      'faithful-dark-mode',
      'faithful-data-display',
      'faithful-design-handoff',
      'faithful-design-tokens',
      'faithful-i18n',
      'faithful-implement-design',
      'faithful-no-visual-change',
      'faithful-responsive',
      'faithful-safe-redesign',
      'faithful-ui-copy',
      'faithful-ui-quality',
      'faithful-ui-states',
    ]);
  });

  for (const [folder, body] of Object.entries(SKILLS)) {
    describe(folder, () => {
      const fm = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(body);
      it("has frontmatter whose name is its folder, within the spec's limits", () => {
        expect(fm, 'frontmatter').not.toBeNull();
        expect(fm?.[1]).toBe(folder);
        expect(fm?.[1]?.length).toBeLessThanOrEqual(64);
        expect(fm?.[1]).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(fm?.[2]?.length).toBeLessThanOrEqual(1024);
        // Every description is paid for in every session; keep the listing small.
        expect(fm?.[2]?.length).toBeLessThanOrEqual(420);
        // A description says WHEN to use it, or the skill never loads itself.
        expect(fm?.[2]).toMatch(/\bUse (when|at|before|for)\b|^For /);
      });
      it('stays small, names a command that proves the work, and never says `npx faithful`', () => {
        expect(body.split('\n').length).toBeLessThan(100);
        expect(body).toMatch(/npx @usefaithful\/cli (verify|audit|parity|outline|spec|guard)/);
        expect(body).not.toMatch(/npx faithful\b/);
      });
    });
  }
});
