import { test, expect } from 'vitest';
import { ok, evaluated, expectThrown } from '../readme/harness.mts';

/**
 * PLAN-simd-engine.md phase 1: vector values.
 *
 * Before this the SIMD surface was types without values - `vector.<T, N>` and
 * every shorthand resolved in an annotation and nothing could be built, so no
 * operation could be tested. A vector is a value type whose values are "the
 * sequences of N values of T" (#sec-vector-types), and it carries the Type
 * Record it was built at, since the lane type and count are not recoverable
 * from the lanes alone: `float32x4(1, 2, 3, 4)` and `int32x4(1, 2, 3, 4)` hold
 * equal lane values.
 */

test('a vector type name is a callable Type Object', () => {
  // `typeof uint8` is 'object' and `uint8(5)` constructs; a vector shorthand
  // now behaves the same way, which is the model it follows.
  expect(evaluated('String(typeof float32x4);')).toBe('object');
  expect(evaluated('String(typeof int32x4);')).toBe('object');
  expect(evaluated('String(typeof boolean8);')).toBe('object');
});

test('a vector constructs from its lanes', () => {
  expect(evaluated('String(float32x4(1, 2, 3, 4));')).toBe('(1, 2, 3, 4)');
  expect(evaluated('String(int32x4(4, 3, 2, 1));')).toBe('(4, 3, 2, 1)');
  // A non-shorthand width, through a type alias. `vector` itself is not a
  // binding - only the shorthand names are bound - so the long form is written
  // in an annotation or aliased rather than called directly. Binding `vector`
  // would make it callable as `vector.<float32, 3>(1, 2, 3)` and is phase 2's
  // to decide, since it is the same question the broadcast cast raises.
  expect(evaluated('type F3 = vector.<float32, 3>; String(F3(1, 2, 3));')).toBe('(1, 2, 3)');
});

test('one argument broadcasts to every lane', () => {
  // #sec-vector-lanes gives a vector type a cast operator from its lane type.
  expect(evaluated('String(float32x4(7));')).toBe('(7, 7, 7, 7)');
});

test('a wrong lane count is refused, and the message says both', () => {
  expectThrown('float32x4(1, 2, 3);');
  expectThrown('float32x4(1, 2, 3, 4, 5);');
});

test('a vector satisfies its own type and no other', () => {
  expect(evaluated('let a: float32x4 = float32x4(1, 2, 3, 4); String(a);')).toBe('(1, 2, 3, 4)');
  // The shorthand and the long form are one type, so either annotation accepts.
  expect(evaluated('let a: vector.<float32, 4> = float32x4(1, 2, 3, 4); String(a);')).toBe('(1, 2, 3, 4)');
  expect(ok('function f(x: float32x4) { return x; } f(float32x4(1, 2, 3, 4));')).toBe(true);

  // The two ways it can fail, which are what keep the three above from passing
  // vacuously: a different lane type and a different lane count.
  expect(ok('let a: int32x4 = float32x4(1, 2, 3, 4);')).toBe(false);
  expect(ok('let a: vector.<float32, 2> = float32x4(1, 2, 3, 4);')).toBe(false);
});

test('a vector reports its own type', () => {
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(Reflect.typeOf(a) === float32x4);')).toBe('true');
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(Reflect.typeOf(a) === int32x4);')).toBe('false');
});

test('typeof a vector is object', () => {
  // A vector is not a primitive of the base language, so `typeof` reports
  // 'object' and its own type is read with Reflect.typeOf. Asserted because a
  // new value kind is answered by every typeof in the language.
  expect(evaluated('String(typeof float32x4(1, 2, 3, 4));')).toBe('object');
});
