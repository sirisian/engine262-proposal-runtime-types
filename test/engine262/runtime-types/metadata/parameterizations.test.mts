import { test, expect } from 'vitest';
import { evaluated, ok, expectThrown } from '../harness.mts';

/**
 * Spec: #sec-primitive-metadata (Primitive Metadata) - how a metadata
 * parameterization is written, interned, and carried.
 *
 * A parameterized primitive is a distinct interned type that carries its
 * metadata, sheds upward to its base, and is unaffected by a numeric type
 * argument. What each hook is ASKED is meta-declarations.test.mts's; what the
 * protocol composes to is protocol-matrix.test.mts's.
 */

const waive = 'meta float32 { default = {}; subtype(a, b) { return true; } } meta float64 { default = {}; subtype(a, b) { return true; } } ';

test('primitive metadata: a metadata-parameterized primitive parses and interns', () => {
  expect(evaluated(waive + 'type Meter = float32.<{ unit: "m" }>; typeof Meter;')).toBe('object');
  // it reflects as a parameterization of its base, and interns
  expect(evaluated(waive + 'type Meter = float32.<{ unit: "m" }>; Reflect.getReflection(Meter).kind;')).toBe('parameterized');
  expect(ok(waive + 'type A = float32.<{ unit: "m" }>; type B = float32.<{ unit: "m" }>; A === B;')).toBe(true);
});

test('primitive metadata: the metadata is carried; the meta hooks are still to come', () => {
  // The metadata is carried on the type and the parameterization is distinct from
  // its base, which is what the validate judgment needs to have anything to read.
  expect(evaluated(waive + 'type Meter = float32.<{ unit: "m" }>; (Meter === float32) ? "same" : "distinct";')).toBe('distinct');
  // Still to come: a meta declaration binding its name so its hooks reach the
  // judgments, and the dimension, bound, and scale semantics written over them.
  expectThrown('meta Bounds { subtype(a, b) { return true; } validate(v, c) { return true; } } Bounds;');
});

// -- random: the typed no-argument Math.random ---------------------------------

test('primitive metadata: a metadata parameterization is carried, not dropped', () => {
  // the argument is an object type written on a primitive, which the metadata
  // protocol reads as metadata rather than as an argument to the primitive
  expect(evaluated(waive + 'type A = float32.<{ unit: "m" }>; Reflect.getReflection(A).kind;')).toBe('parameterized');
  // it is a distinct type from its bare base, where before it interned back to it
  expect(evaluated(waive + 'type A = float32.<{ unit: "m" }>; (A === float32) ? "same" : "distinct";')).toBe('distinct');
  // and two different metadata are two different types
  expect(evaluated(waive + 'type A = float32.<{ unit: "m" }>; type B = float32.<{ unit: "s" }>; (A === B) ? "same" : "distinct";')).toBe('distinct');
  expect(evaluated(waive + 'type A = float32.<{ minimum: 0 }>; type B = float32.<{ minimum: 1 }>; (A === B) ? "same" : "distinct";')).toBe('distinct');
  expect(evaluated(waive + 'type A = float32.<{ unit: "m" }>; type B = float64.<{ unit: "m" }>; (A === B) ? "same" : "distinct";')).toBe('distinct');
});

test('primitive metadata: metadata that agrees interns to one type', () => {
  // interning compares the metadata field for field rather than by identity, since
  // two mentions of one shape must be one type
  expect(evaluated(waive + 'type A = float32.<{ unit: "m" }>; type B = float32.<{ unit: "m" }>; (A === B) ? "same" : "distinct";')).toBe('same');
  expect(evaluated(waive + 'type A = float32.<{ m: 1, s: -2 }>; type B = float32.<{ m: 1, s: -2 }>; (A === B) ? "same" : "distinct";')).toBe('same');
});

test('primitive metadata: a parameterization still sheds upward to its base', () => {
  // the default meaning of a parameterization is a brand, shed upward freely
  expect(evaluated(waive + 'type A = float32.<{ unit: "m" }>; String(Reflect.isAssignable(A, float32));')).toBe('true');
});

test('primitive metadata: a numeric type argument is unaffected', () => {
  // only an object argument is metadata; a width or a lane count is not
  expect(evaluated('Reflect.getReflection(float32).kind;')).toBe('primitive');
  expect(evaluated('type U = uint.<8>; String(U.bitLength);')).toBe('8');
  expect(evaluated('type V = vector.<float32, 4>; String(V.byteLength);')).toBe('16');
});

test('primitive metadata: a parameterization over `number` defaults as one over a value type does', () => {
  // `number.<M>` had NO default while
  // the identical `float64.<M>` had one, and the asymmetry was not in the
  // metadata at all: DefaultValueOf stamped the zero of `number` as a typed
  // number, and #sec-value-types keeps `number` free of stamped values - "a
  // plain Number is not a member of a numeric value type" - so the default of
  // `number` was not a member of `number`, and the ~parameterized~ arm's
  // membership test failed at its base check.
  //
  // #sec-defaultvalueof step 2 returns "the value of _t_ representing 0", and
  // #sec-value-types says ECMAScript "defines Number and BigInt that way"
  // already; the value of the Number type representing 0 is the Number +0.
  const bounds = 'type B = { lo: number }; '
    + 'meta B { default = { lo: -Infinity }; subtype(a, b) { return a.lo >= b.lo; } validate(v, c) { return Number(v) >= c.lo; } } ';
  // Rewritten for the CROSSING model:
  // a default is the base's zero having crossed, so it needs a way in. The
  // PARITY is what this test is for and holds under either model - `number` and
  // `float64` must answer alike - so each case is asked of both bases.
  const castN = 'primitive number { operator number.<{ lo: 0 }>(): number.<{ lo: 0 }> { return this; } } ';
  const castF = 'primitive float64 { operator float64.<{ lo: 0 }>(): float64.<{ lo: 0 }> { return this; } } ';
  // A `validate` that ADMITS the base's zero lets the crossing complete, and
  // the parameterization has that zero.
  expect(evaluated(`${bounds}${castN} type NonNeg = number.<{ lo: 0 }>; let n: NonNeg; String(Number(n));`)).toBe('0');
  expect(evaluated(`${bounds}${castF} type NonNegF = float64.<{ lo: 0 }>; let n: NonNegF; String(Number(n));`)).toBe('0');
  // One that REJECTS it has no default even with the cast declared: "a cast is
  // how a value gets IN, not a way past what the metadata requires".
  const castN1 = 'primitive number { operator number.<{ lo: 1 }>(): number.<{ lo: 1 }> { return this; } } ';
  const castF1 = 'primitive float64 { operator float64.<{ lo: 1 }>(): float64.<{ lo: 1 }> { return this; } } ';
  expectThrown(`${bounds}${castN1} type Pos = number.<{ lo: 1 }>; let p: Pos;`);
  expectThrown(`${bounds}${castF1} type PosF = float64.<{ lo: 1 }>; let p: PosF;`);
  // And with no way in at all, neither base has a default - `subtype` cannot
  // admit an unconstrained value into a bound.
  expectThrown(`${bounds} type NonNeg = number.<{ lo: 0 }>; let n: NonNeg;`);
  expectThrown(`${bounds} type NonNegF = float64.<{ lo: 0 }>; let n: NonNegF;`);
});

test('primitive metadata: the zero of `number` is a plain Number and is one of `number`', () => {
  // The invariant the case above rests on, asserted directly so a regression
  // names itself: DefaultValueOf's own result must satisfy IsOfType against the
  // type it was asked for. `bigint` was always plain here; `number` is now
  // consistent with it, while a value type's zero stays stamped.
  ok('let x: number; let a: any = {}; a.v = x; a.v is number;');
  expect(evaluated('let x: number; String(x === 0);')).toBe('true');
  expect(evaluated('let b: bigint; String(b === 0n);')).toBe('true');
  // A fixed-extent array of `number` is zero-filled rather than refused, which
  // the stamped zero had made a type error at the declaration itself.
  expect(evaluated('let a: [2].<number>; String(a[0] === 0 && a[1] === 0);')).toBe('true');
  // A value type keeps its own zero, distinct from a plain Number's.
  ok('let f: float64; let a: any = {}; a.v = f; a.v is float64;');
});

test('primitive metadata: a value of a `number` parameterization is a value of `number`', () => {
  // The `number` arm of membership
  // said "a plain Number, and nothing carried", which is right about the value
  // types and wrong about `number`'s own parameterizations: a value of
  // `number.<M>` is necessarily carried, the parameterization being what it
  // carries, so it failed to be a value of `number` - against the branding rule
  // of #sec-parameterized-types, "a parameterized type is a subtype of its
  // base, so the brand is shed freely on the way up".
  //
  // It surfaced through the cast rather than directly: DECLARING a cast on
  // `number` broke assignments that worked without one, because the crossing's
  // stamped result then failed the base check at the boundary that received it.
  const bounds = 'type B = { lo: number }; '
    + 'meta B { default = { lo: -Infinity }; subtype(a, b) { return a.lo >= b.lo; } validate(v, c) { return Number(v) >= c.lo; } } '
    + 'type NonNeg = number.<{ lo: 0 }>; ';
  const cast = 'primitive number { operator number.<{ lo: 0 }>(): number.<{ lo: 0 }> { return this; } } ';

  // With a cast declared, a bare value crosses, the crossing's result is of the
  // parameterization AND of its base, and `validate` still gates it.
  expect(evaluated(`${bounds}${cast} let n: NonNeg = 5; String(Number(n));`)).toBe('5');
  expect(evaluated(`${bounds}${cast} let n: NonNeg = 5; let b = {}; b.v = n; String(b.v is number);`)).toBe('true');
  expect(evaluated(`${bounds}${cast} let n: NonNeg = 5; let b = {}; b.v = n; String(b.v is NonNeg);`)).toBe('true');
  expect(evaluated(`${bounds}${cast} let n: NonNeg = 5; function f(v: number) { return Number(v); } String(f(n));`)).toBe('5');
  expectThrown(`${bounds}${cast} let n: NonNeg = -5;`);

  // Shedding is by name after the parameterization comes off, so a value type's
  // value is still not a `number` and a plain Number is still not a float64:
  // #sec-value-types keeps the two populations apart, and this must not merge
  // them.
  expect(evaluated('let f: float64 = (1 := float64); let b = {}; b.v = f; String(b.v is number);')).toBe('false');
  expect(evaluated('let u: uint8 = (1 := uint8); let b = {}; b.v = u; String(b.v is number);')).toBe('false');
  expect(evaluated('let b = {}; b.v = 1; String(b.v is float64);')).toBe('false');
  expect(evaluated('let b = {}; b.v = 1; String(b.v is number);')).toBe('true');
});

test('primitive metadata: a default crosses, so both spellings of a declaration agree', () => {
  // #sec-defaultvalueof's
  // ~parameterized~ step crosses the base's zero into the parameterization
  // (#sec-metadata-conversion) instead of testing membership, so `let w: T;`
  // and `let w: T = 0;` succeed together and fail together. The four cases
  // below are the whole matrix over one base: the two ways through a crossing
  // are `subtype` and a cast, and `validate` is what the cast costs.
  const dims = 'type Dim = { m: number }; '
    + 'meta Dim { default = { m: 0 }; subtype(a, b) { return a.m === b.m; } } ';
  const bounded = 'type Bnd = { lo: number }; '
    + 'meta Bnd { default = { lo: -Infinity }; subtype(a, b) { return a.lo >= b.lo; } validate(v, c) { return Number(v) >= c.lo; } } ';
  const castD = 'primitive float64 { operator float64.<{ m: 1 }>(): float64.<{ m: 1 }> { return this; } } ';
  const castB = 'primitive float64 { operator float64.<{ lo: 0 }>(): float64.<{ lo: 0 }> { return this; } } ';

  // No `validate`, cast declared: the crossing completes and the zero exists.
  // This is the design's own units case, which the membership model denied.
  expect(evaluated(`${dims}${castD} let w: float64.<{ m: 1 }>; String(Number(w));`)).toBe('0');
  expect(evaluated(`${dims}${castD} let w: float64.<{ m: 1 }> = 10; String(Number(w));`)).toBe('10');
  // No `validate`, no cast: neither spelling gets a value.
  expectThrown(`${dims} let w: float64.<{ m: 1 }>;`);
  expectThrown(`${dims} let w: float64.<{ m: 1 }> = 10;`);
  // `validate` admitting the zero, cast declared: both spellings work, and the
  // hook still gates what crosses.
  expect(evaluated(`${bounded}${castB} let w: float64.<{ lo: 0 }>; String(Number(w));`)).toBe('0');
  expectThrown(`${bounded}${castB} let w: float64.<{ lo: 0 }> = -5;`);
  // `validate` admitting the zero, no cast: the default is refused exactly as
  // the initializer is. Membership would have admitted the first and not the
  // second, which is the disagreement this step existed to end.
  expectThrown(`${bounded} let w: float64.<{ lo: 0 }>;`);
  expectThrown(`${bounded} let w: float64.<{ lo: 0 }> = 0;`);

  // The zero a crossing produces is AT the parameterization, not a bare base
  // value that the annotation would then refuse.
  expect(evaluated(`${dims}${castD} type Meter = float64.<{ m: 1 }>; let w: Meter; `
    + 'let b = {}; b.v = w; String(b.v is Meter);')).toBe('true');

  // And the requirement the model was chosen for: a value type class whose
  // fields are unit-typed is zero-fillable, which #sec-typed-classes needs for
  // `let d: [10].<A>;` to hold ten zero-filled instances.
  const vec = `${dims}${castD} type Meter = float64.<{ m: 1 }>; class Vec3 { x: Meter; y: Meter; z: Meter; } `;
  expect(evaluated(`${vec} const v = new Vec3(); String(Number(v.x) + Number(v.y) + Number(v.z));`)).toBe('0');
  expect(evaluated(`${vec} let d: [10].<Vec3>; String(Number(d.length)) + ":" + String(Number(d[0].x));`)).toBe('10:0');
  expect(evaluated(`${dims}${castD} let m: [4].<float64.<{ m: 1 }>>; String(Number(m[3]));`)).toBe('0');
});
