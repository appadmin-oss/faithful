/**
 * `faithful parity`: through a refactor or a whole redesign, does the product still do the
 * same things?
 *
 * It compares a BEFORE build with an AFTER build on what a user can DO — every link and button
 * by role, accessible name and target; every form by where it sends, how, and the field names
 * the server reads; the page landmarks; the routes; the script errors — and never on how it
 * looks. No pixels and no DOM structure are compared, so a full re-skin cannot raise a false
 * alarm; what it catches is the failure agents are reported for again and again: a feature
 * quietly dropped while doing something else.
 *
 * Controls are matched across changed markup in tiers: the same target, then the same name,
 * then a close name. A control matched only by a close name is reported as RENAMED, to be
 * confirmed — never passed silently, because "Delete account" becoming "Account" is a change
 * somebody has to have meant.
 *
 * Before trusting its own answer it checks itself: the BEFORE page with a control removed and
 * a field renamed must fail (`selfCheck`). A comparison that cannot see a planted loss says
 * "inconclusive" rather than "pass".
 */
import type { AuditFacts } from './audit-facts.js';
import type { ScreenResult } from './compare.js';
import type { Finding, Kind, Severity } from './findings.js';

type Control = AuditFacts['controls'][number];
type Form = AuditFacts['forms'][number];

export const normName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[→›»←‹«…·•|*+!?.,:;'"()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** A link's target, comparable across two origins: path + query, no trailing slash; "#" is no target. */
export function normHref(href: string | undefined, base: string): string {
  if (!href || href === '#' || /^javascript:/i.test(href)) return '';
  try {
    const u = new URL(href, base || 'http://x.invalid/');
    const b = base ? new URL(base) : undefined;
    if (b && u.origin !== b.origin) return u.href.replace(/\/$/, '');
    return (
      (u.pathname.replace(/\/$/, '') || '/') + u.search + (u.pathname === (b?.pathname ?? '') && u.hash ? u.hash : '')
    );
  } catch {
    return href;
  }
}

const tokens = (s: string) => new Set(normName(s).split(' ').filter(Boolean));
function similar(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / (A.size + B.size - n);
}

export interface ControlMatch {
  before: Control;
  after?: Control;
  how: 'same' | 'target' | 'name' | 'close' | 'lost';
}

/** Match every BEFORE control to at most one AFTER control, strictest tier first. */
export function matchControls(before: Control[], after: Control[], bBase: string, aBase: string): ControlMatch[] {
  const left = [...after];
  const take = (pred: (c: Control) => boolean) => {
    const i = left.findIndex(pred);
    return i < 0 ? undefined : left.splice(i, 1)[0];
  };
  const out: ControlMatch[] = before.map((b) => ({ before: b, how: 'lost' as const }));
  const key = (c: Control, base: string) => normHref(c.href, base);
  const tiers: [ControlMatch['how'], (b: Control, a: Control) => boolean][] = [
    ['same', (b, a) => a.role === b.role && normName(a.name) === normName(b.name) && key(a, aBase) === key(b, bBase)],
    ['target', (b, a) => a.role === b.role && !!key(b, bBase) && key(a, aBase) === key(b, bBase)],
    ['name', (b, a) => a.role === b.role && !!normName(b.name) && normName(a.name) === normName(b.name)],
    ['close', (b, a) => a.role === b.role && similar(a.name, b.name) >= 0.5],
  ];
  for (const [how, ok] of tiers) {
    for (const m of out) {
      if (m.how !== 'lost') continue;
      const a = take((c) => ok(m.before, c));
      if (a) {
        m.after = a;
        m.how = how;
      }
    }
  }
  return out;
}

function matchForms(before: Form[], after: Form[]): { before: Form; after?: Form }[] {
  const left = [...after];
  const names = (f: Form) => new Set(f.fields.map((x) => x.name).filter(Boolean));
  const overlap = (a: Form, b: Form) => {
    const A = names(a);
    const B = names(b);
    let n = 0;
    for (const x of A) if (B.has(x)) n++;
    return A.size + B.size ? n / (A.size + B.size - n) : 0;
  };
  return before.map((b) => {
    let best = -1;
    let score = 0;
    left.forEach((a, i) => {
      const s = overlap(b, a) + (a.action === b.action ? 0.5 : 0);
      if (s > score) {
        score = s;
        best = i;
      }
    });
    if (best < 0 || score < 0.3) return { before: b };
    return { before: b, after: left.splice(best, 1)[0] as Form };
  });
}

export function compareParity(before: AuditFacts, after: AuditFacts, screen: string): ScreenResult {
  const vp = `${after.viewport.width}x${after.viewport.height}`;
  const findings: Finding[] = [];
  const add = (kind: Kind, severity: Severity, detail: string, buildId?: string, label?: string) => {
    const f: Finding = { kind, severity, detail, screen, viewport: vp };
    if (buildId) f.buildId = buildId;
    if (label) f.label = label;
    findings.push(f);
  };

  // The page itself.
  const sb = before.runtime?.status ?? 200;
  const sa = after.runtime?.status ?? 200;
  if (sb < 400 && sa >= 400) {
    add('lost', 'error', `the page answers ${sa} (it answered ${sb} before)`);
    return result(screen, vp, findings);
  }

  // Controls.
  const matches = matchControls(before.controls, after.controls, before.url, after.url);
  /* Matching is one-to-one, so a redesign that links a page twice where the old one linked
     it ten times "lost" eight links — eight errors about a destination every visitor can
     still reach (a real redesign: 262 "lost" against 30 destinations actually gone). What a
     user can no longer DO is reach a target; fewer routes to one they can still reach is a
     note, counted once per target. */
  const stillLinked = new Set(after.controls.map((c) => normHref(c.href, after.url)).filter(Boolean));
  const fewer = new Map<string, number>();
  for (const m of matches) {
    const b = m.before;
    const what = `${b.role} "${b.name || '(unnamed)'}"${b.href ? ` → ${normHref(b.href, before.url) || b.href}` : ''}`;
    const target = normHref(b.href, before.url);
    if (m.how === 'lost' && target && stillLinked.has(target)) fewer.set(target, (fewer.get(target) ?? 0) + 1);
    else if (m.how === 'lost') add('lost', 'error', `${what} is gone`, undefined, b.name);
    else if (m.how === 'name' && normHref(m.after?.href, after.url) !== normHref(b.href, before.url))
      add(
        'changed',
        'error',
        `${b.role} "${b.name}" now goes to ${normHref(m.after?.href, after.url) || '(nowhere)'}, not ${normHref(b.href, before.url) || '(nowhere)'}`,
        m.after?.sel,
        b.name,
      );
    else if ((m.how === 'target' || m.how === 'close') && m.after && normName(m.after.name) !== normName(b.name))
      add(
        'renamed',
        'warn',
        `${b.role} "${b.name}" is now "${m.after.name}": confirm it is the same action`,
        m.after.sel,
        b.name,
      );
    if (m.after && b.visible && !m.after.visible)
      add('changed', 'info', `${b.role} "${b.name}" is now hidden until opened (a menu?)`, m.after.sel);
  }
  for (const [t, n] of fewer)
    add('changed', 'info', `${n} fewer link${n === 1 ? '' : 's'} to ${t}; it is still linked from the page`);
  const added = after.controls.length - matches.filter((m) => m.after).length;
  if (added > 0) add('changed', 'info', `${added} new control${added === 1 ? '' : 's'}`);

  // Forms: the server reads field NAMES, so a renamed field is a broken form.
  for (const { before: fb, after: fa } of matchForms(before.forms, after.forms)) {
    const label = fb.fields
      .map((x) => x.name)
      .filter(Boolean)
      .slice(0, 3)
      .join(', ');
    if (!fa) {
      add('lost', 'error', `the form sending ${label || 'no named fields'} to ${fb.action || '(this page)'} is gone`);
      continue;
    }
    if (fa.action !== fb.action)
      add(
        'changed',
        'error',
        `a form now sends to ${fa.action || '(this page)'}, not ${fb.action || '(this page)'}`,
        fa.sel,
      );
    if (fa.method !== fb.method)
      add('changed', 'error', `a form now sends by ${fa.method.toUpperCase()}, not ${fb.method.toUpperCase()}`, fa.sel);
    for (const x of fb.fields) {
      if (!x.name) continue;
      const y = fa.fields.find((f) => f.name === x.name);
      if (!y) {
        const guess = fa.fields.find(
          (f) =>
            f.name &&
            !fb.fields.some((o) => o.name === f.name) &&
            (similar(f.label, x.label) >= 0.5 || f.type === x.type),
        );
        add(
          'lost',
          'error',
          `field "${x.name}"${x.label ? ` (${x.label})` : ''} is gone from the form${guess ? `; is it "${guess.name}"? The server reads the name` : ''}`,
          fa.sel,
        );
        continue;
      }
      if (y.type !== x.type) add('changed', 'warn', `field "${x.name}" changed type: ${x.type} → ${y.type}`, fa.sel);
      if (x.required && !y.required) add('changed', 'warn', `field "${x.name}" is no longer required`, fa.sel);
    }
  }

  // Landmarks a screen-reader user navigates by.
  for (const l of before.landmarks) if (!after.landmarks.includes(l)) add('lost', 'warn', `the ${l} landmark is gone`);

  // Regressions in what the page does on load.
  const newErrors = (after.runtime?.errors ?? []).filter((e) => !(before.runtime?.errors ?? []).includes(e));
  for (const e of newErrors.slice(0, 3)) add('runtime', 'error', `new script error: ${e.slice(0, 140)}`);
  const fb = before.runtime?.failed.length ?? 0;
  const fa = after.runtime?.failed.length ?? 0;
  if (fa > fb) add('runtime', 'warn', `${fa - fb} more failed request${fa - fb === 1 ? '' : 's'} than before`);

  // The H1 is what the page is; copy may change, but a page losing its heading is a finding.
  const h1b = before.headings.find((h) => h.level === 1);
  if (h1b && !after.headings.some((h) => h.level === 1))
    add('lost', 'warn', `the page heading "${h1b.text.slice(0, 50)}" is gone`);

  return result(screen, vp, findings);
}

function result(screen: string, vp: string, findings: Finding[]): ScreenResult {
  const errors = findings.filter((x) => x.severity === 'error').length;
  const warns = findings.filter((x) => x.severity === 'warn').length;
  const zero = { ok: 0, total: 0 };
  return {
    screen,
    viewport: vp,
    findings,
    stats: {
      designElements: 0,
      buildElements: 0,
      matched: 0,
      coverage: 1,
      position: zero,
      text: zero,
      color: zero,
      style: zero,
    },
    score: Math.max(0, 100 - errors * 10 - warns * 3),
  };
}

/**
 * Can this comparison see a loss on THIS page? Remove one control and rename one form field in
 * a copy of BEFORE; both must be reported. When the page has nothing to remove, or the planted
 * losses slip through, the answer is "inconclusive" — never a pass.
 */
export function selfCheck(before: AuditFacts): { ok: boolean; reason?: string } {
  if (!before.controls.length && !before.forms.length)
    return { ok: false, reason: 'the before page has no links, buttons or forms to compare' };
  const broken: AuditFacts = structuredClone(before);
  broken.controls = broken.controls.slice(1);
  const field = broken.forms.flatMap((f) => f.fields).find((f) => f.name);
  if (field) field.name = `${field.name}__planted`;
  const r = compareParity(before, broken, 'self-check');
  const sawControl = before.controls.length === 0 || r.findings.some((f) => f.kind === 'lost' || f.kind === 'renamed');
  const sawField = !field || r.findings.some((f) => f.kind === 'lost' && f.detail.includes('field'));
  return sawControl && sawField ? { ok: true } : { ok: false, reason: 'a planted loss was not detected' };
}
