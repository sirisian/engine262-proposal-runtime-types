import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * A CAST DECLARED AGAINST A META TYPE COVERS EVERY PARAMETERIZATION IT GOVERNS (#sec-primitive-operator-blocks,
 * #sec-primitive-metadata). A crossing is declared as `primitive float32 { operator float32.<Dimensions>() {
 * return this; } }`, and declaring it means `let d: Meter;` and `let d: Meter = 0;` succeed together and fail
 * together.
 *
 * Cast selection therefore asks COVERAGE, not identity: it compares the cast's target to the crossing's target
 * by whether the meta type governs it, because a family is never the same type as one of its members (`SameType`
 * would match nothing, and declaring the cast would change no program). The record for `float32.<Dimensions>`
 * keeps the meta type: `Dimensions`'s members are types rather than values, so the metadata object it reduces
 * to is EMPTY, and the record must not be indistinguishable from `float32.<{}>`. The guard rows below are as
 * important as the enabling ones: coverage follows the META TYPE and must not become a blanket match.
 *
 * Unspecified: that declaring the cast also makes a `Vector3` of `Meter` fields zero-fillable, which a memory
 * layout needs. The specification states the crossing's conversion, not the zero.
 */

const DIM = `type Dimensions = { m: int32 };
meta Dimensions { default = { m: 0 }; subtype(a: Dimensions, b: Dimensions): boolean { return a.m == b.m; } }
type Meter = float32.<{ m: 1 }>;
type SqMeter = float32.<{ m: 2 }>;
`;
const META_CAST = 'primitive float32 { operator float32.<Dimensions>() { return this; } }\n';
const EXACT_CAST = 'primitive float32 { operator float32.<{ m: 1 }>() { return this; } }\n';

// A meta type whose `validate` refuses zero, which the document uses to say a
// type "has no meaningful zero".
const BOUNDS = `type NB = { lo: float32 };
meta NB {
  default = { lo: 0 };
  subtype(a: NB, b: NB): boolean { return a.lo == b.lo; }
  validate(value: float32, c: NB): boolean { return value >= c.lo; }
}
type Pos = float32.<{ lo: 1 }>;
`;

test('the documented cast form makes a literal cross', () => {
  expect(evaluated(`${DIM}${META_CAST}const d: Meter = 5; String(d);`)).toBe('5');
  expect(evaluated(`${DIM}${META_CAST}const d: Meter = 5; String(d instanceof float32);`)).toBe('true');
});

test('the documented cast form gives the type a zero', () => {
  // "a metadata-bearing type's default is its base's zero having crossed into
  // it - the same crossing an initializer of the base's type makes".
  expect(evaluated(`${DIM}${META_CAST}let d: Meter; String(d);`)).toBe('0');
});

test('the documented cast form makes an aggregate zero-fillable', () => {
  // The zero-fill case: `let d: [10].<Vector3>;` holds ten zero-filled instances.
  expect(evaluated(`${DIM}${META_CAST}class V3 { x: Meter; y: Meter; z: Meter; }
    const f: [10].<V3>; String(f.length);`)).toBe('10');
  expect(evaluated(`${DIM}${META_CAST}class V3 { x: Meter; y: Meter; z: Meter; }
    const f: [10].<V3>; String(f[0].x);`)).toBe('0');
});

test('a meta-type cast covers every parameterization it governs', () => {
  // One cast, both dimensions - which is what declaring it against the FAMILY
  // means, and the whole difference from the exact form below.
  expect(evaluated(`${DIM}${META_CAST}let q: SqMeter; String(q);`)).toBe('0');
});

test('a cast against ONE parameterization covers only that one', () => {
  // The first guard. A blanket match would give `SqMeter` a zero it was never
  // declared to have.
  expect(evaluated(`${DIM}${EXACT_CAST}const d: Meter = 5; String(d);`)).toBe('5');
  expectThrown(`${DIM}${EXACT_CAST}let q: SqMeter;`, 'has no default value');
});

test('an empty-metadata cast covers nothing', () => {
  // The second guard, and the reason the meta type is kept on the RECORD rather
  // than inferred from emptiness: `float32.<{}>` and `float32.<Dimensions>`
  // reduce to the same metadata object, so emptiness cannot tell them apart.
  expectThrown(`${DIM}primitive float32 { operator float32.<{}>() { return this; } }
    const d: Meter = 5;`, 'is not assignable to');
});

test('a cast for one meta type does not cover another', () => {
  // The third guard: `Dimensions` governs `m`, not `lo`.
  expectThrown(`${DIM}${META_CAST}${BOUNDS}let p: Pos;`, 'has no default value');
});

test('with no cast declared there is still no zero', () => {
  // "Without it, nothing crosses from an unconstrained value, so there is no
  // zero." Unchanged, and the half of "succeed together and fail together" that
  // always worked.
  expectThrown(`${DIM}let d: Meter;`, 'has no default value');
  expectThrown(`${DIM}const d: Meter = 5;`, 'is not assignable to');
});

test('the crossing runs validate, so a cast is a way in and not a way past a bound', () => {
  const CAST = 'primitive float32 { operator float32.<NB>() { return this; } }\n';
  expect(evaluated(`${BOUNDS}${CAST}const p: Pos = 5; String(p);`)).toBe('5');
  expectThrown(`${BOUNDS}${CAST}const p: Pos = 0;`, 'is not assignable to');
  // And a type whose `validate` refuses zero HAS no zero, cast or no cast -
  // the document's own `NumberBounds` case.
  expectThrown(`${BOUNDS}${CAST}let p: Pos;`, 'has no default value');
});

test('the explicit conversion and the subtype hook are untouched', () => {
  expect(evaluated(`${DIM}String(5 := Meter);`)).toBe('5');
  expect(evaluated(`${DIM}const a = (5 := Meter); const b: Meter = a; String(b);`)).toBe('5');
  // Cross-dimension assignment is the `subtype` hook's decision, not the cast's.
  expectThrown(`${DIM}const a = (5 := Meter); const b: SqMeter = a;`, 'is not assignable to');
});
