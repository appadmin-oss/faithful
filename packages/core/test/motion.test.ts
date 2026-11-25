import type { Motion, MotionTrack } from '@usefaithful/spec';
import { describe, expect, it } from 'vitest';
import { motionDiff, sameEasing, sameTime } from '../src/motion.js';

const t = (
  property: string,
  duration: number,
  easing = 'ease',
  delay = 0,
  extra: Partial<MotionTrack> = {},
): MotionTrack => ({
  property,
  duration,
  delay,
  easing,
  ...extra,
});
const m = (over: Partial<Motion>): Motion => ({ transitions: [], animations: [], scripted: [], ...over });

describe('motion tolerances', () => {
  it('a duration differs past 50ms AND 20%: 300 and 320 are one fade, 300 and 150 are not', () => {
    expect(sameTime(300, 320)).toBe(true);
    expect(sameTime(300, 150)).toBe(false);
    expect(sameTime(2000, 2300)).toBe(true);
    expect(sameTime(80, 140)).toBe(false);
  });

  it('an easing is its curve: a keyword equals its cubic-bézier; ease-out is not linear', () => {
    expect(sameEasing('ease-out', 'cubic-bezier(0, 0, 0.58, 1)')).toBe(true);
    expect(sameEasing('cubic-bezier(0.2, 0, 0, 1)', 'cubic-bezier(0.25, 0, 0, 1)')).toBe(true);
    expect(sameEasing('ease-out', 'linear')).toBe(false);
    expect(sameEasing('steps(4, end)', 'steps(4,end)')).toBe(true);
  });
});

describe('motionDiff', () => {
  it('the same motion is nothing; `all` stands for the property it covers', () => {
    expect(motionDiff(m({ transitions: [t('transform', 300)] }), m({ transitions: [t('transform', 310)] }))).toEqual(
      [],
    );
    expect(motionDiff(m({ transitions: [t('opacity', 200)] }), m({ transitions: [t('all', 200)] }))).toEqual([]);
  });

  it('motion the design has and the build lacks is an error; timing is a warning', () => {
    expect(motionDiff(m({ transitions: [t('transform', 300)] }), undefined).map((x) => x.severity)).toEqual(['error']);
    expect(
      motionDiff(
        m({ transitions: [t('transform', 300, 'ease-out')] }),
        m({ transitions: [t('transform', 150, 'linear', 200)] }),
      ),
    ).toEqual([
      { severity: 'warn', detail: 'transform transition: 300ms → 150ms, ease-out → linear, delay 0ms → 200ms' },
    ]);
  });

  it('movement the design does not have is a warning; a colour transition it does not have is a note', () => {
    expect(motionDiff(undefined, m({ transitions: [t('transform', 300)] })).map((x) => x.severity)).toEqual(['warn']);
    expect(motionDiff(undefined, m({ transitions: [t('color', 150)] })).map((x) => x.severity)).toEqual(['info']);
  });

  it('animations pair by what their keyframes change, never by name; a script may play a design keyframe', () => {
    const d = m({
      animations: [t('pulse', 2000, 'ease-in-out', 0, { iterations: 'infinite', keyframes: ['transform'] })],
    });
    const b = m({
      scripted: [t('script', 2000, 'ease-in-out', 0, { iterations: 'infinite', keyframes: ['transform'] })],
    });
    expect(motionDiff(d, b)).toEqual([]);
    const once = m({ animations: [t('beat', 2000, 'ease-in-out', 0, { iterations: '1', keyframes: ['transform'] })] });
    expect(motionDiff(d, once).map((x) => x.detail)).toEqual(['animation of transform: ×infinite → ×1']);
  });
});
