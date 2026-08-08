import { test, expect } from 'vitest';
import { evaluated, expectThrown, run } from '../harness.mts';

/**
 * proposal-runtime-types (#sec-metadata-decomposition, table-metadata-values;
 * primitivemetadata.md): a RANGE as a metadata value.
 *
 * The metadata language is closed, and this adds one row to it. A range is
 * admitted as a VALUE, not as an implementation of an interface: the four
 * shapes are the whole of what a metadata range may be, its endpoints are
 * compile-time constants, and two ranges are equivalent when they have the same
 * shape, the same bound at each endpoint the shape has, and SameValue at each
 * endpoint's value.
 *
 * It is carried STRUCTURALLY -- endpoints and bounds, never a Range object --
 * for the reason the pattern row already gives: two objects are never equal, so
 * one range written in two modules would otherwise be two types. A Range is
 * materialized at the one boundary where metadata reaches a program, which is
 * where a hook receives it, so `bounds.contains(v)` is a real call on a real
 * range while the carried form stays comparable.
 *
 * The `NumberBounds` block below is transcribed from primitivemetadata.md
 * rather than built into the engine, which deliberately ships no meta type of
 * its own. Two deviations from the document are recorded at their tests: the
 * shape uses OPTIONAL keys with an empty default, and narrowing is not
 * exercised at all.
 */

// The design's meta type, as test source. Its `subtype` is containment and its
// `validate` is membership, exactly as primitivemetadata.md writes them.
const NumberBounds = `
type NumberBounds = { bounds?: Range, nonZero?: boolean };

function excludesZero(c) {
  return c.nonZero === true || (c.bounds !== undefined && !c.bounds.contains(0));
}

meta NumberBounds {
  default = {};
  subtype(sub, sup) {
    if (excludesZero(sup) && !excludesZero(sub)) return false;
    if (sup.bounds === undefined) return true;
    if (sub.bounds === undefined) return false;
    return sup.bounds.contains(sub.bounds);
  }
  validate(value, constraint) {
    if (constraint.nonZero === true && Number(value) === 0) return false;
    return constraint.bounds === undefined || constraint.bounds.contains(Number(value));
  }
}
`;

// -- the value language -------------------------------------------------------

test('every range shape is a metadata value', () => {
  expect(evaluated(`${NumberBounds} type T = float64.<{ bounds: 0..<10 }>; "ok";`)).toBe('ok');
  expect(evaluated(`${NumberBounds} type T = float64.<{ bounds: 1..=6 }>; "ok";`)).toBe('ok');
  expect(evaluated(`${NumberBounds} type T = float64.<{ bounds: 0<..<10 }>; "ok";`)).toBe('ok');
  expect(evaluated(`${NumberBounds} type T = float64.<{ bounds: 0<..=10 }>; "ok";`)).toBe('ok');
  expect(evaluated(`${NumberBounds} type T = float64.<{ bounds: 0.. }>; "ok";`)).toBe('ok');
  expect(evaluated(`${NumberBounds} type T = float64.<{ bounds: 0<.. }>; "ok";`)).toBe('ok');
  expect(evaluated(`${NumberBounds} type T = float64.<{ bounds: ..<10 }>; "ok";`)).toBe('ok');
  expect(evaluated(`${NumberBounds} type T = float64.<{ bounds: ..=10 }>; "ok";`)).toBe('ok');
  expect(evaluated(`${NumberBounds} type T = float64.<{ bounds: .. }>; "ok";`)).toBe('ok');
});

test('an endpoint may be negative, and a range stands alone as a type', () => {
  expect(evaluated(`${NumberBounds} type Latitude = float64.<{ bounds: -90..=90 }>; "ok";`)).toBe('ok');
  expect(evaluated('type T = 0..<10; "ok";')).toBe('ok');
});

test('a range prints as it was written, not as its carrier', () => {
  // The carried form is endpoints and bounds. Without a display rule a
  // diagnostic names the carrier's fields, which is unreadable in the place a
  // reader most needs the type: the message telling them what went wrong.
  const message = (source: string) => {
    const c = run(source) as { Value?: { HostDefinedMessageString?: string } };
    return c.Value?.HostDefinedMessageString ?? '';
  };
  expect(message(`${NumberBounds} type D = float64.<{ bounds: 1..=6 }>; (99 := D);`))
    .toContain('float64.<{ bounds: 1..=6 }>');
  expect(message(`${NumberBounds} type U = float64.<{ bounds: 0..<1 }>; (9 := U);`))
    .toContain('float64.<{ bounds: 0..<1 }>');
});

// -- the meta type ------------------------------------------------------------

test('the NumberBounds block from the design declares and runs', () => {
  expect(evaluated(`${NumberBounds} "ok";`)).toBe('ok');
});

test('a hook receives a Range, not the carried form', () => {
  // This is the whole point of materializing at the hook boundary: the hook
  // calls `contains` on its bounds, so what arrives must be a range.
  const probe = NumberBounds.replace(
    'return constraint.bounds === undefined || constraint.bounds.contains(Number(value));',
    'return String(constraint.bounds.start) === "0" && constraint.bounds.contains(3);',
  );
  expect(evaluated(`${probe} type A = float64.<{ bounds: 0..<10 }>; (3 := A); "ok";`)).toBe('ok');
});

test('validate admits and rejects by the bounds', () => {
  expect(evaluated(`${NumberBounds} type D = float64.<{ bounds: 1..=6 }>; Number(6 := D);`)).toBe('6');
  expectThrown(`${NumberBounds} type D = float64.<{ bounds: 1..=6 }>; (9 := D);`);
  // An open endpoint excludes its own value.
  expectThrown(`${NumberBounds} type U = float64.<{ bounds: 0..<1 }>; (1 := U);`);
  expect(evaluated(`${NumberBounds} type P = float64.<{ bounds: 0<.. }>; Number(0.5 := P);`)).toBe('0.5');
  expectThrown(`${NumberBounds} type P = float64.<{ bounds: 0<.. }>; (0 := P);`);
});

test('nonZero is the constraint a range cannot express', () => {
  expectThrown(`${NumberBounds} type NZ = float64.<{ nonZero: true }>; (0 := NZ);`);
  expect(evaluated(`${NumberBounds} type NZ = float64.<{ nonZero: true }>; Number(5 := NZ);`)).toBe('5');
});

test('subtype is containment of one range in another', () => {
  // The wider type admits a value of the narrower one.
  expect(evaluated(`${NumberBounds}
    type Wide = float64.<{ bounds: 0..<10 }>;
    type Narrow = float64.<{ bounds: 2..<5 }>;
    const n = (3 := Narrow); Number(n := Wide);`)).toBe('3');
  // And the narrower rejects a value of the wider whose bounds do not fit.
  expectThrown(`${NumberBounds}
    type Wide = float64.<{ bounds: 0..<10 }>;
    type Narrow = float64.<{ bounds: 2..<5 }>;
    const w = (7 := Wide); (w := Narrow);`);
});

test('bounds that exclude zero satisfy nonZero without saying so', () => {
  // primitivemetadata.md: "a range that already excludes zero is non-zero
  // whether or not it says so", which is what keeps a positive type a Divisor.
  expect(evaluated(`${NumberBounds}
    type Positive = float64.<{ bounds: 1.. }>;
    type NonZero = float64.<{ nonZero: true }>;
    const p = (5 := Positive); Number(p := NonZero);`)).toBe('5');
});

// -- equivalence --------------------------------------------------------------

test('one spelling is one type, and differing bounds are different types', () => {
  // Structural equivalence: same shape, same bound at each endpoint, SameValue
  // endpoints. Two objects would never be equal, which is why the carried form
  // is not a Range.
  expect(evaluated(`${NumberBounds}
    type A = float64.<{ bounds: 1..=6 }>;
    type B = float64.<{ bounds: 1..=6 }>;
    const a = (3 := A); Number(a := B);`)).toBe('3');
  // `1..=6` and `1..<6` differ only in the end's bound, and that is enough:
  // assigning across them consults `subtype`, which rejects.
  expectThrown(`${NumberBounds}
    type A = float64.<{ bounds: 1..=6 }>;
    type B = float64.<{ bounds: 1..<6 }>;
    const a = (6 := A); (a := B);`);
});

/**
 * DEFERRED, with what was measured.
 *
 * 1. The design's `default = { bounds: .., nonZero: false }` cannot be written
 *    here. A meta type's default is checked by ordinary membership against its
 *    constraint shape, and that judgement does not admit a Range against a
 *    `Range`-typed field -- nor a RegExp against a `RegExp`-typed one, so this
 *    is a pre-existing limit of the meta-type machinery rather than anything
 *    about ranges. The optional-key shape with an empty default is what the
 *    engine can host, so the hooks above test for absence where the design's
 *    total default lets them not. Design-side this is a real question: the
 *    total default was adopted precisely to delete those absence checks.
 *
 * 2. Metadata is consulted on the CONVERSION path (`:=`) and not on a plain
 *    annotation: `const a: A = 3` is rejected by static assignability before a
 *    hook runs. Pre-existing, and why every test above casts.
 *
 * 3. NARROWING is not exercised, and cannot be. The engine invokes five of the
 *    protocol's hooks -- `subtype`, `validate`, `conversionFactor`, `quantize`,
 *    and `describe` -- and neither `narrow` nor `rescale`. The checker's own
 *    narrowing (src/type-system/narrowing.mts) is type-level and routes no
 *    comparison through a metadata hook, so `if (x >= 0)` giving `x` a bounded
 *    type inside the branch has nothing to test against. This is the stage's
 *    recorded deferral, and it takes `rescale` with it: the `scale` operation
 *    the range value now has was built for that hook's one caller.
 */
