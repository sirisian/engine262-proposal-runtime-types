import { expect, test } from 'vitest';
import { run } from '../harness.mts';

/**
 * A MEET BELONGS TO THE PROGRAM, AND THE META TYPE, THAT COMPUTED IT.
 *
 * #table-meta-hooks `meet`: the checking pass runs the hook - user code - and records
 * the result so `CanonicalizeType`, which is synchronous, can reduce the intersection
 * to it. The record was a module-level map keyed by the DISPLAY of the two members.
 * It outlived the program, and its key named no meta type, so:
 *
 * - a program's result depended on unrelated programs run before it in the process:
 *   the same program was refused fresh and admitted once another had recorded a meet
 *   for a pair that DISPLAYS the same;
 * - one program's user-written `meet` was applied to a different program's meta type.
 *
 * Meta types are per agent (`claimsForAgent`), so keying the record by the meta type
 * scopes it to both. Each test below uses a bounds pair no other test uses, so nothing
 * earlier in the file can have primed it; each asserts only that a result does not
 * CHANGE when another program runs first, so it holds whatever that result is.
 */

function outcome(source: string): string {
  const c = run(source) as { Type: string, Value: unknown };
  if (c.Type === 'throw') {
    let message = '';
    const e = c.Value as { properties?: Map<{ stringValue?: () => string }, { Value?: { stringValue?: () => string } }> };
    if (e?.properties) {
      for (const [k, d] of e.properties) {
        if (k.stringValue?.() === 'message') {
          message = d.Value?.stringValue?.() ?? '';
        }
      }
    }
    return `threw: ${message}`;
  }
  return `ok: ${(c.Value as { stringValue?: () => string })?.stringValue?.() ?? String(c.Value)}`;
}

const meta = (meet: string) => 'type NB = { bounds?: RangeBounds.<any> }; meta NB { default = {}; '
  + 'validate(value, c) { return c.bounds === undefined || c.bounds.contains(value); } '
  + 'subtype(a,b) { if (b.bounds === undefined) return true; if (a.bounds === undefined) return false; '
  + `return b.bounds.contains(a.bounds); } ${meet} } `
  + 'primitive uint8 { operator uint8.<NB>() { return this; } } ';
const HONEST = 'meet(a,b) { if (a.bounds === undefined) return b; if (b.bounds === undefined) return a; '
  + 'const r = a.bounds.intersect(b.bounds); return r.isEmpty ? null : { bounds: r }; }';

test('a program\'s result does not depend on a program run before it', () => {
  const pair = 'type C = uint8.<{ bounds: 11..=40 }> & uint8.<{ bounds: 25..=60 }>; ';
  const literal = `${meta(HONEST)}${pair} const c: C = 30; String(c);`;
  const fresh = outcome(literal);
  // Another program computes, and records, the meet of a pair that DISPLAYS the same.
  expect(outcome(`${meta(HONEST)}${pair} String(30 := C);`)).toBe('ok: 30');
  expect(outcome(literal)).toBe(fresh);
});

test('one program\'s meet is not applied to another program\'s meta type', () => {
  const pair = 'type C = uint8.<{ bounds: 12..=41 }> & uint8.<{ bounds: 26..=61 }>; ';
  // A meet that is not the members' intersection: `C` IS what the hook returns.
  const narrow = `${meta('meet(a,b) { return { bounds: 30..=30 }; }')}${pair} const c: C = 31; String(c);`;
  const fresh = outcome(narrow);
  expect(outcome(`${meta(HONEST)}${pair} String(31 := C);`)).toBe('ok: 31');
  expect(outcome(narrow)).toBe(fresh);
});

test('within one program the meet still reduces the intersection', () => {
  // The scoping must not lose the reduction the record exists for.
  const pair = 'type C = uint8.<{ bounds: 13..=42 }> & uint8.<{ bounds: 27..=62 }>; ';
  expect(outcome(`${meta(HONEST)}${pair} type M = uint8.<{ bounds: 27..=42 }>; String(C === M);`)).toBe('ok: true');
  expect(outcome(`${meta(HONEST)}${pair} type M = uint8.<{ bounds: 27..=43 }>; String(C === M);`)).toBe('ok: false');
  expect(outcome(`${meta(HONEST)}${pair} String(14 := C);`)).toContain('uint.<8>.<{ bounds: 27..=42 }>');
});

test('an empty meet is still reported', () => {
  const r = outcome(`${meta(HONEST)} type T = uint8.<{ bounds: 14..=20 }> & uint8.<{ bounds: 30..=40 }>;`);
  expect(r).toContain('intersection is never');
});
