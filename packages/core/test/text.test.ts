import { describe, expect, it } from 'vitest';
import { compareCopy, dice, normalizeText, snippet } from '../src/text.js';

describe('text', () => {
  it('normalises typography a design tool and a browser disagree on', () => {
    expect(normalizeText('Don’t wait — vote…')).toBe("Don't wait - vote...");
    expect(normalizeText('  a\n\t b ')).toBe('a b');
  });
  it('passes copy only on an exact match, however similar', () => {
    expect(dice('Save draft', 'Save drafts')).toBeGreaterThan(0.9);
    expect(compareCopy('Save draft', 'Save drafts')).toBe('mismatch');
    expect(compareCopy('Save draft', 'SAVE DRAFT')).toBe('case');
    expect(compareCopy('Save draft', ' Save draft ')).toBe('exact');
  });
  it('dice is 0 for unrelated text and 1 for equal text', () => {
    expect(dice('abc', 'xyz')).toBe(0);
    expect(dice('Hello', 'hello')).toBe(1);
  });
  it('shortens', () => {
    expect(snippet('x'.repeat(50), 10)).toHaveLength(10);
  });
});
