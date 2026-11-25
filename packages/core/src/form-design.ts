/**
 * Form design, measured. Four rules, each from research rather than taste:
 *
 *  1. A field is as wide as what goes in it. Baymard's testing: a field whose input length is
 *     known (a year, a code, a price) should be sized to that length, not to the column; a
 *     field far wider than its content reads as "write a lot here" and hides the one number it
 *     holds in a bar of white. GOV.UK sizes inputs in characters for the same reason.
 *     https://baymard.com/research-articles/form-field-usability-matching-user-expectations
 *  2. One column. Baymard found two-column forms produce more skipped and misread fields (the
 *     eye has to go down AND across); CXL measured single-column completion 15.4s faster. A row
 *     of 2–3 parts of one thing (a date, city and postcode) is fine; a form laid out in columns
 *     is not. https://baymard.com/research-articles/avoid-multi-column-forms
 *  3. A label is closer to its own field than to the one above it (Gestalt proximity; NN/g on
 *     form white space): otherwise which field it names is a guess.
 *     https://www.nngroup.com/articles/form-design-white-space/
 *  4. A unit belongs beside the number (a prefix or suffix), not only in the label. A note.
 *
 * Phones are exempt from 1 and 2: there a field is meant to fill the width, and one column is
 * the only layout. Only fields whose length is KNOWN are sized (rule 1): a name or an address
 * has a normal average, and a consistent default width is right for those.
 */

export interface FormField {
  sel: string;
  /** Page box, px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Font size, px: a character is about 0.55 of it (digits and average lower case). */
  font: number;
  /** Characters the field is expected to hold, when known (see expectedChars). */
  expect?: number;
  /** Its label: text and page box, when it has one. */
  label?: { text: string; x: number; y: number; w: number; h: number };
  /** A number field (for the unit rule). */
  numeric?: boolean;
}

export interface FormLayout {
  sel: string;
  /** The form's own width, px. */
  width: number;
  fields: FormField[];
}

/** Characters a field is expected to hold, from what its markup says; undefined when unknown. */
export function expectedChars(f: {
  type: string;
  maxlength?: number;
  max?: string;
  step?: string;
  value?: string;
  autocomplete?: string;
  options?: string[];
}): number | undefined {
  const ac: Record<string, number> = {
    'postal-code': 8,
    'cc-csc': 4,
    'cc-exp': 7,
    'cc-exp-month': 2,
    'cc-exp-year': 4,
    'one-time-code': 6,
    'bday-day': 2,
    'bday-month': 2,
    'bday-year': 4,
    tel: 15,
  };
  if (f.autocomplete && ac[f.autocomplete] !== undefined) return ac[f.autocomplete];
  if (f.type === 'select') return f.options?.length ? Math.max(...f.options.map((o) => o.length)) + 3 : undefined;
  if (f.maxlength && f.maxlength > 0 && f.maxlength <= 24) return f.maxlength;
  if (f.type === 'number') {
    const decimals = f.step && /\./.test(f.step) ? (f.step.split('.')[1]?.length ?? 0) : 0;
    if (f.max && /^-?\d+(\.\d+)?$/.test(f.max))
      return f.max.replace(/^-|\..*$/g, '').length + (decimals ? decimals + 1 : 0);
    // A number with no stated maximum: what it holds now, with room for a few more digits.
    return Math.max((f.value ?? '').length, 4) + 2;
  }
  if (f.type === 'date') return 12;
  if (f.type === 'time') return 7;
  if (f.type === 'month') return 9;
  if (f.type === 'tel') return 15;
  return undefined;
}

export interface FormVerdict {
  /** Fields far wider than their content: the field, its width in characters, what it holds. */
  oversized: { sel: string; label: string; chars: number; expect: number; px: number }[];
  /** The form is laid out in columns: rows holding two or more fields, and how many rows in all. */
  columns?: { sel: string; multiRows: number; rows: number };
  /** Labels closer to the field above than to their own. */
  ambiguous: { sel: string; label: string; own: number; above: number }[];
  /** Number fields whose unit is only in the label. */
  unitInLabel: { sel: string; label: string; unit: string }[];
}

const UNIT = /\(\s*(\$|%|€|£|₦|usd|ngn|gbp|eur|px|ms|s|days?|hours?|h|months?|minutes?|min|weeks?|kg|g|m)\s*\)\s*$/i;

/** Judge one form at one viewport width. */
export function judgeForm(form: FormLayout, viewportWidth: number): FormVerdict {
  const desktop = viewportWidth >= 768;
  const out: FormVerdict = { oversized: [], ambiguous: [], unitInLabel: [] };
  for (const f of form.fields) {
    const chars = f.w / (f.font * 0.55);
    // Rule 1: three times what it holds, and at least 16 characters to spare, and 160px wide.
    if (
      desktop &&
      f.expect !== undefined &&
      f.expect <= 24 &&
      f.w >= 160 &&
      chars > Math.max(3 * f.expect, f.expect + 16)
    )
      out.oversized.push({
        sel: f.sel,
        label: f.label?.text ?? '',
        chars: Math.round(chars),
        expect: f.expect,
        px: Math.round(f.w),
      });
    const unit = f.numeric && f.label ? UNIT.exec(f.label.text) : null;
    if (unit) out.unitInLabel.push({ sel: f.sel, label: f.label?.text ?? '', unit: unit[1] as string });
  }
  // Rule 2: rows of fields by their tops; a form is in columns when three or more rows hold two
  // or more fields and they are at least half its rows. One row of filters, or a date in three
  // parts, is not a column layout.
  const sorted = [...form.fields].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: FormField[][] = [];
  for (const f of sorted) {
    const row = rows.find((r) => Math.abs((r[0] as FormField).y - f.y) < 8);
    if (row) row.push(f);
    else rows.push([f]);
  }
  const multi = rows.filter((r) => r.length >= 2);
  if (desktop && multi.length >= 3 && multi.length >= rows.length / 2)
    out.columns = { sel: form.sel, multiRows: multi.length, rows: rows.length };
  // Rule 3: a label above its field, closer to the field above it (same column) than its own.
  for (const f of form.fields) {
    const l = f.label;
    if (!l || l.y + l.h > f.y + 2) continue;
    const own = f.y - (l.y + l.h);
    const above = form.fields
      .filter((g) => g !== f && g.y + g.h <= l.y + 1 && g.x < l.x + l.w && g.x + g.w > l.x)
      .sort((a, b) => b.y + b.h - (a.y + a.h))[0];
    if (!above) continue;
    const gap = l.y - (above.y + above.h);
    if (gap <= own) out.ambiguous.push({ sel: f.sel, label: l.text, own: Math.round(own), above: Math.round(gap) });
  }
  return out;
}
