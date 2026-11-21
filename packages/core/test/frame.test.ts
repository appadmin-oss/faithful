import { describe, expect, it } from 'vitest';
import { compareScreens } from '../src/compare.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { box, screen, text } from './helpers.js';

const cfg = DEFAULT_CONFIG;
const page = () => [
  box('card', 100, 100, 600, 400),
  text('h', 'Choose your plan', 120, 120, 300, 32, { fontSize: 24, fontWeight: 700 }),
  text('p', 'Cancel any time. No fees.', 120, 170, 300, 24),
];
// A design runtime's root wrapper: text-free, the full width, the full page.
const frame = () => box('root', 0, 0, 1280, 800, { background: '#faf8f4', radius: 0 });

describe('page frames', () => {
  it('an unpaired page-sized wrapper in the design is not missing content', () => {
    const r = compareScreens(screen([frame(), ...page()]), screen(page()), cfg);
    expect(r.findings).toEqual([]);
    // It used to be the largest box on the screen and cost most of the coverage.
    expect(r.score).toBe(100);
  });

  it('nor is one only the build has', () => {
    const r = compareScreens(screen(page()), screen([frame(), ...page()]), cfg);
    expect(r.findings).toEqual([]);
  });

  it('a large real box that is missing is still reported', () => {
    const hero = box('hero', 0, 0, 1280, 500, { background: '#3b2c1f', radius: 0 });
    const r = compareScreens(screen([hero, ...page()]), screen(page()), cfg);
    expect(r.findings.map((f) => f.kind)).toContain('missing');
    expect(r.score).toBeLessThan(100);
  });

  it('a page-sized element that carries text is content, and is still reported', () => {
    const banner = { ...text('b', 'Sale', 0, 0, 1280, 800), kind: 'text' as const };
    const r = compareScreens(screen([banner, ...page()]), screen(page()), cfg);
    expect(r.findings.map((f) => f.kind)).toContain('missing');
  });
});

describe('nested boxes with the same geometry', () => {
  it('pair by their look, not by array order', () => {
    const wrap = box('wrap', 0, 44, 1280, 760, { background: '#120c07', radius: 0 });
    const hero = box('hero', 0, 44, 1280, 760, { background: '#3b2c1f', radius: 22 });
    const both = [text('h', 'Where young musicians become complete artists', 80, 600, 700, 80)];
    // The build lists them the other way round: array order would cross them.
    const r = compareScreens(
      screen([wrap, hero, ...both]),
      screen([{ ...hero, id: 'b-hero' }, { ...wrap, id: 'b-wrap' }, ...both]),
      cfg,
    );
    expect(r.findings.filter((f) => f.kind === 'background' || f.kind === 'radius')).toEqual([]);
  });

  it('a box whose fill really changed is still reported', () => {
    const hero = box('hero', 0, 44, 1280, 760, { background: '#3b2c1f', radius: 22 });
    const r = compareScreens(
      screen([hero]),
      screen([{ ...hero, style: { ...hero.style, background: '#2a6b3a' } }]),
      cfg,
    );
    expect(r.findings.map((f) => f.kind)).toContain('background');
  });
});

describe('changed copy is paired near, not across the page', () => {
  it('a loose likeness five screens away is missing plus extra, not wrong copy', () => {
    const cap = text('cap', 'Photo — crash programme class (upload)', 40, 900, 360, 20);
    const link = text('ln', 'Crash Programme', 520, 6000, 130, 36);
    const r = compareScreens(screen([cap]), screen([link]), cfg);
    expect(r.findings.map((f) => f.kind).sort()).toEqual(['extra', 'missing']);
  });

  it('copy changed in place is still one text finding', () => {
    const r = compareScreens(
      screen([text('h', 'More than music lessons', 40, 900, 400, 40)]),
      screen([text('h', 'More than music classes', 40, 900, 400, 40)]),
      cfg,
    );
    expect(r.findings.map((f) => f.kind)).toEqual(['text']);
  });

  it('a heading whose section moved far down still pairs when the words are nearly the same', () => {
    const r = compareScreens(
      screen([text('h', 'Four levels, one continuous path', 40, 900, 500, 40)]),
      screen([text('h', 'Four levels, one continuous path.', 40, 4900, 500, 40)]),
      cfg,
    );
    expect(r.findings.map((f) => f.kind)).not.toContain('missing');
  });
});
