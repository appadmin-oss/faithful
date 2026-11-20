import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_CONFIG, resolveConfig } from '../src/config.js';

const bad = (user: unknown, message: RegExp) => {
  expect(() => resolveConfig(user), JSON.stringify(user)).toThrow(ConfigError);
  expect(() => resolveConfig(user), JSON.stringify(user)).toThrow(message);
};

describe('resolveConfig', () => {
  it('defaults, and a valid override, pass', () => {
    expect(resolveConfig(undefined)).toEqual(DEFAULT_CONFIG);
    const c = resolveConfig({
      passScore: 95,
      maxFindings: 12,
      tolerances: { px: 3, colorPass: 0.5, colorFail: 3 },
      viewports: [
        { name: 'phone', width: 390, height: 844 },
        { width: 1440, height: 900 },
      ],
      guards: { rules: { 'no-uppercase': true }, typeScale: [12, 16, 20] },
    });
    expect(c.guards.rules['no-uppercase']).toBe(true);
    expect(c.guards.rules['no-important']).toBe(true);
    expect(c.viewports[1]?.name).toBe('1440x900');
  });

  it('rejects an unknown rule id and a rule that is not true or false', () => {
    bad({ guards: { rules: { 'no-raw-colour': true } } }, /unknown rule guards\.rules\.no-raw-colour/);
    bad({ guards: { rules: { 'no-important': 1 } } }, /guards\.rules\.no-important should be true or false/);
  });

  it('rejects numbers out of range, naming the key', () => {
    bad({ passScore: 500 }, /passScore should be a number from 0 to 100, got 500/);
    bad({ passScore: -1 }, /passScore/);
    bad({ maxFindings: -3 }, /maxFindings should be a whole number of at least 1/);
    bad({ maxFindings: 2.5 }, /maxFindings/);
    bad({ tolerances: { px: -5 } }, /tolerances\.px should be a number of at least 0/);
    bad({ tolerances: { pct: 2 } }, /tolerances\.pct should be a number from 0 to 1/);
    bad({ tolerances: { colorPass: -3, colorFail: -1 } }, /tolerances\.colorPass/);
    bad({ tolerances: { colorPass: 3, colorFail: 1 } }, /colorPass must not exceed colorFail/);
    bad({ minTarget: -1 }, /minTarget/);
    bad({ guards: { typeScale: [16, 0] } }, /guards\.typeScale\[1\]/);
  });

  it('rejects viewports that are not positive whole numbers of px', () => {
    bad(
      { viewports: [{ name: 'x', width: '1280', height: 800 }] },
      /viewports\[0\]\.width should be a positive whole number/,
    );
    bad({ viewports: [{ name: 'x', width: 1280, height: 0 }] }, /viewports\[0\]\.height/);
    bad({ viewports: [{ name: 'x', width: 1280.5, height: 800 }] }, /viewports\[0\]\.width/);
    bad({ viewports: [{ name: 'x', width: 1280, height: 800, scale: 2 }] }, /unknown setting viewports\[0\]\.scale/);
    bad({ viewports: ['1280x800'] }, /viewports\[0\] should be/);
    bad({ viewports: [] }, /viewports cannot be empty/);
  });

  it('rejects inherited keys and lists of the wrong type', () => {
    bad(JSON.parse('{"__proto__": {"passScore": 0}}'), /unknown setting __proto__/);
    bad({ constructor: {} }, /unknown setting constructor/);
    bad({ ignore: [1] }, /ignore should list strings/);
    bad({ nope: 1 }, /unknown setting nope/);
  });
});
