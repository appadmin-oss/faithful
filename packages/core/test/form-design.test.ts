import { describe, expect, it } from 'vitest';
import { expectedChars, type FormField, judgeForm } from '../src/form-design.js';

const field = (o: Partial<FormField> & { y: number }): FormField => ({
  sel: `input:nth-of-type(${o.y})`,
  x: 20,
  w: 560,
  h: 40,
  font: 16,
  ...o,
});
const labelled = (text: string, y: number, rest: Partial<FormField> = {}): FormField =>
  field({ y, label: { text, x: 20, y: y - 22, w: 200, h: 18 }, ...rest });

describe('what a field is expected to hold', () => {
  it('reads it from the markup, and says nothing when the markup does not know', () => {
    expect(expectedChars({ type: 'number', max: '100' })).toBe(3);
    expect(expectedChars({ type: 'number', value: '70' })).toBe(6);
    expect(expectedChars({ type: 'text', maxlength: 4 })).toBe(4);
    expect(expectedChars({ type: 'text', autocomplete: 'postal-code' })).toBe(8);
    expect(expectedChars({ type: 'select', options: ['Yes', 'No'] })).toBe(6);
    expect(expectedChars({ type: 'text' })).toBeUndefined();
    expect(expectedChars({ type: 'email' })).toBeUndefined();
  });
});

describe('form design', () => {
  it('a price in a 560px field is far wider than what it holds; the same field sized to it is not', () => {
    const wide = judgeForm(
      { sel: 'form', width: 600, fields: [labelled('Crash Programme ($)', 40, { expect: 6, numeric: true })] },
      1440,
    );
    expect(wide.oversized).toEqual([
      { sel: 'input:nth-of-type(40)', label: 'Crash Programme ($)', chars: 64, expect: 6, px: 560 },
    ]);
    const sized = judgeForm({ sel: 'form', width: 600, fields: [labelled('Fee', 40, { expect: 6, w: 120 })] }, 1440);
    expect(sized.oversized).toEqual([]);
  });

  it('a name or an email (no known length) keeps the default width; a phone fills its screen', () => {
    expect(judgeForm({ sel: 'f', width: 600, fields: [labelled('Name', 40)] }, 1440).oversized).toEqual([]);
    expect(
      judgeForm({ sel: 'f', width: 340, fields: [labelled('Fee', 40, { expect: 6, w: 340 })] }, 390).oversized,
    ).toEqual([]);
  });

  it('a form laid out in two columns is named; one row of filters or a date in parts is not', () => {
    const two = [0, 1, 2, 3].flatMap((i) => [
      labelled(`Left ${i}`, 40 + i * 80, { w: 260 }),
      labelled(`Right ${i}`, 40 + i * 80, { x: 300, w: 260 }),
    ]);
    expect(judgeForm({ sel: 'form#settings', width: 600, fields: two }, 1440).columns).toEqual({
      sel: 'form#settings',
      multiRows: 4,
      rows: 4,
    });
    const filters = [field({ y: 10, w: 200 }), field({ y: 10, x: 240, w: 120 }), field({ y: 10, x: 380, w: 120 })];
    expect(judgeForm({ sel: 'f', width: 600, fields: filters }, 1440).columns).toBeUndefined();
    const date = [
      labelled('Name', 40),
      field({ y: 120, w: 60 }),
      field({ y: 120, x: 90, w: 60 }),
      field({ y: 120, x: 160, w: 90 }),
      labelled('Email', 200),
    ];
    expect(judgeForm({ sel: 'f', width: 600, fields: date }, 1440).columns).toBeUndefined();
  });

  it('a label nearer the field above than its own is ambiguous; one sitting on its field is not', () => {
    // Field above ends at 100; the label starts 4px below it and sits 12px above its own field.
    const above = field({ y: 60, h: 40 });
    const bad = field({ y: 134, label: { text: 'Postcode', x: 20, y: 104, w: 80, h: 18 } });
    expect(judgeForm({ sel: 'f', width: 600, fields: [above, bad] }, 1440).ambiguous).toEqual([
      { sel: 'input:nth-of-type(134)', label: 'Postcode', own: 12, above: 4 },
    ]);
    const good = field({ y: 150, label: { text: 'Postcode', x: 20, y: 124, w: 80, h: 18 } });
    expect(judgeForm({ sel: 'f', width: 600, fields: [above, good] }, 1440).ambiguous).toEqual([]);
  });

  it('a unit only in a number field’s label is noted; a word in brackets is not a unit', () => {
    const v = judgeForm(
      {
        sel: 'f',
        width: 600,
        fields: [labelled('Online surcharge (%)', 40, { numeric: true }), labelled('Name (optional)', 120)],
      },
      1440,
    );
    expect(v.unitInLabel).toEqual([{ sel: 'input:nth-of-type(40)', label: 'Online surcharge (%)', unit: '%' }]);
  });
});
