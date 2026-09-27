import { expect, test } from 'vitest';
import { run, expectStaticTypeError } from '../harness.mts';

/**
 * A LITERAL AT AN INTERSECTION OF PARAMETERIZATIONS IS DECIDED AGAINST THE MEET.
 *
 * #table-meta-hooks `meet`: "An intersection of exactly two ~parameterized~ Type
 * Records over one base reduces to their MEET ... So `uint8<{ bounds: 1..=10 }> &
 * uint8<{ bounds: 5..=20 }>` is `uint8<{ bounds: 5..=10 }>`, and the two spellings
 * intern to one Type Object." `:=`, a typed value and `===` all followed the meet. A
 * literal did not: the walk decided it before the checking pass had run the meet
 * hook, against the intersection UNREDUCED, and refused the specification's own `7`.
 *
 * A literal crossing into a single parameterization was already deferred to the pass,
 * which has the hooks and the casts. One into an intersection of parameterizations of
 * one base is now deferred the same way, and the pass decides it against what the
 * intersection reduces to - after the meets are computed. For a numeric
 * parameterization that is #sec-literal-propagation's question, whether a cast covers
 * the target; `validate` then runs where the binding does, against the meet.
 *
 * Where a meta type declines to give a meet, the intersection stands. A value carries
 * one metadata record, so it is not one of two different parameterizations at once,
 * and the run time refuses it; the pass gives that answer before running.
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

const HONEST = 'meet(a,b) { if (a.bounds === undefined) return b; if (b.bounds === undefined) return a; '
  + 'const r = a.bounds.intersect(b.bounds); return r.isEmpty ? null : { bounds: r }; }';
const nb = (meet: string, cast = true) => 'type NB = { bounds?: RangeBounds.<any> }; meta NB { default = {}; '
  + 'validate(value, c) { return c.bounds === undefined || c.bounds.contains(value); } '
  + 'subtype(a,b) { if (b.bounds === undefined) return true; if (a.bounds === undefined) return false; '
  + `return b.bounds.contains(a.bounds); } ${meet} } `
  + `${cast ? 'primitive uint8 { operator uint8.<NB>() { return this; } } ' : ''}`
  + 'type C = uint8.<{ bounds: 1..=10 }> & uint8.<{ bounds: 5..=20 }>; ';
const H = nb(HONEST);

test('the specification\'s example admits a literal in the meet', () => {
  expect(outcome(`${H} const c: C = 7; String(c);`)).toBe('ok: 7');
  expect(outcome(`${H} const a: C = 5; const b: C = 10; String(a) + ',' + String(b);`)).toBe('ok: 5,10');
});

test('a literal outside the meet is refused, against the meet', () => {
  // In one member only, and in neither: each is refused naming the MEET, as `:=`
  // and a typed value are.
  for (const v of [4, 15, 21]) {
    expect(outcome(`${H} const c: C = ${v}; String(c);`)).toContain('"uint.<8>.<{ bounds: 5..=10 }>"');
  }
});

test('a meet of one value', () => {
  const D = 'type D = uint8.<{ bounds: 1..=3 }> & uint8.<{ bounds: 3..=5 }>; ';
  expect(outcome(`${H}${D} const c: D = 3; String(c);`)).toBe('ok: 3');
  expect(outcome(`${H}${D} const c: D = 2; String(c);`)).toContain('"uint.<8>.<{ bounds: 3..=3 }>"');
  expect(outcome(`${H}${D} const c: D = 4; String(c);`)).toContain('"uint.<8>.<{ bounds: 3..=3 }>"');
});

test('the literal follows the meet, not the members', () => {
  // The hook returns `6..=6`, which is not the members' intersection - and `C` IS
  // what it returns. `7` is in both members and not in the meet, and is refused
  // naming the meet, as `:=` refuses it.
  //
  // What this guards, measured: a literal decided against the UNREDUCED
  // intersection, the defect fixed here. Not a pass that consulted a member instead
  // of the meet - for a NUMERIC parameterization the pass asks only whether a cast
  // covers the target, the same question of a member as of the meet, and the
  // binding then decides the value against the meet either way. Guarding that needs
  // a value-decided parameterization, whose crossing the pass itself runs.
  const N = nb('meet(a,b) { return { bounds: 6..=6 }; }');
  expect(outcome(`${N} const c: C = 7; String(c);`)).toContain('"uint.<8>.<{ bounds: 6..=6 }>"');
  expect(outcome(`${N} String(7 := C);`)).toContain('"uint.<8>.<{ bounds: 6..=6 }>"');
  expect(outcome(`${N} const c: C = 6; String(c);`)).toBe('ok: 6');
});

test('a value-decided parameterization follows the meet before running', () => {
  // THE MEET-FOLLOWS GUARD FOR THE PASS. A `string` parameterization is decided by
  // running the crossing, in the pass - so here the pass's own choice of target is
  // observable before the program runs. The hook returns `6..=6`; `"abcdefg"` is in
  // both members and not in the meet. Decided against the meet it is refused before
  // running; decided against a member it would be admitted, and refused only when the
  // binding ran.
  const sb = (meet: string) => 'type SB = { len?: RangeBounds.<any> }; meta SB { default = {}; '
    + 'validate(value, c) { return c.len === undefined || c.len.contains(value.length); } '
    + 'subtype(a,b) { if (b.len === undefined) return true; if (a.len === undefined) return false; '
    + `return b.len.contains(a.len); } ${meet} } `
    + 'type S = string.<{ len: 1..=10 }> & string.<{ len: 5..=20 }>; ';
  const N = sb('meet(a,b) { return { len: 6..=6 }; }');
  expectStaticTypeError(`${N} if (false) { const s: S = "abcdefg"; }`);
  expect(outcome(`${N} const s: S = "abcdef"; s;`)).toBe('ok: abcdef');
  const HS = sb('meet(a,b) { if (a.len === undefined) return b; if (b.len === undefined) return a; '
    + 'const r = a.len.intersect(b.len); return r.isEmpty ? null : { len: r }; }');
  expect(outcome(`${HS} const s: S = "abcdefg"; s;`)).toBe('ok: abcdefg');
  expectStaticTypeError(`${HS} if (false) { const s: S = "abc"; }`);
});

test('without a cast the literal is still refused before running', () => {
  // #sec-literal-propagation: a parameterized numeric is reachable by a literal
  // only through a cast the program declares - at an intersection as at one type.
  expectStaticTypeError(`${nb(HONEST, false)} if (false) { const c: C = 7; }`);
});

test('an intersection with no meet stands, and is refused before running', () => {
  // THE STANDING GUARD. No `meet` hook: the intersection is not reduced, and a value
  // carries one metadata record, so it is not of both. Deciding each member in turn
  // would admit `7` here, before running, and the binding would then refuse it.
  expectStaticTypeError(`${nb('')} if (false) { const c: C = 7; }`);
});

test('the other routes, and a single parameterization, are unchanged', () => {
  expect(outcome(`${H} const t: uint8 = 7; const c: C = t; String(c) + ',' + String(7 := C);`)).toBe('ok: 7,7');
  expect(outcome(`${H} const u: uint8.<{ bounds: 1..=10 }> = 7; String(u);`)).toBe('ok: 7');
  expect(outcome(`${H} type T = uint8.<{ bounds: 1..=3 }> & uint8.<{ bounds: 8..=9 }>;`))
    .toContain('intersection is never');
});
