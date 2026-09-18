import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-vector-component-accessors with #sec-type-errors.
 *
 * "An accessor whose key names no lane twice is assignable, and takes a value of
 * the accessor's own Static Type. An accessor whose key names a lane twice is
 * not assignable, since an assignment to it would give one lane two values; it
 * is a type error to assign to one."
 *
 * A type error, so an Early Error. The rule was written once, as
 * `isAssignableAccessor`, and reached only from the runtime store path - so
 * `a.xx = a.xy` threw when the store ran, and the same line inside a function
 * nothing called was accepted outright. The checking pass now applies the same
 * predicate at the assignment target.
 *
 * Reading a repeated accessor is untouched: `a.xx` is a perfectly good
 * `vector.<float32, 2>`, and only the WRITE has two values for one lane.
 */

const A = 'let a: float32x4 = float32x4(1, 2, 3, 4); ';

test('assigning to an accessor that names a lane twice is refused', () => {
  expectStaticTypeError(`${A}a.xx = a.xy;`);
  expectStaticTypeError(`${A}a.yy = a.xy;`);
  // Three and four lanes, where only one of them repeats.
  expectStaticTypeError(`${A}a.xyx = a.xyz;`);
  // The colour set is the same set of lanes under other names.
  expectStaticTypeError(`${A}a.rr = a.rg;`);
  // A compound assignment stores back, so it is a write like any other.
  expectStaticTypeError(`${A}a.xx += a.xy;`);
});

test('the refusal does not wait for the store to run', () => {
  // The whole point of the move: a function nothing calls is still checked.
  expectStaticTypeError('function f(a: float32x4): void { a.xx = a.xy; }');
  expectStaticTypeError('class C { m(v: float32x4): void { v.rr = v.rg; } }');
});

test('an accessor naming each lane once is assignable', () => {
  expect(evaluated(`${A}a.xy = a.zw; String(a.lane.<0>());`)).toBe('3');
  expect(evaluated(`${A}a.x = (9 := float32); String(a.lane.<0>());`)).toBe('9');
  // Order is free; only repetition is refused.
  expect(evaluated(`${A}a.yx = a.xy; String(a.lane.<0>());`)).toBe('2');
});

test('reading a repeated accessor is unaffected', () => {
  // "An accessor whose key names a lane twice" is refused as a TARGET. As a
  // value it is an ordinary vector of the named lanes.
  expect(evaluated(`${A}let r: vector.<float32, 2> = a.xx; String(r.lane.<1>());`)).toBe('1');
  expect(evaluated(`${A}String(Reflect.typeOf(a.xx));`)).toBe('vector.<float32, 2>');
});

test('a member that merely looks like an accessor is untouched', () => {
  // The rule is about vectors. A class field or an object property named `xx`
  // is a property, and assigning to it is ordinary.
  expect(evaluated('class C { xx: uint8 = 1; } let c: C = new C(); c.xx = 2; String(c.xx);')).toBe('2');
  expect(evaluated('let o = { xx: 1 }; o.xx = 2; String(o.xx);')).toBe('2');
});

test('a receiver the checker cannot see is judged at run time', () => {
  // #sec-type-errors reserves a thrown error for "the `any` boundary and other
  // genuinely dynamic checks", so the runtime half of this rule still has to
  // work - the static move must not have removed it.
  expectThrownKind('let a: any = float32x4(1, 2, 3, 4); a.xx = 1;', 'TypeError');
});
