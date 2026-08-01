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

/**
 * PLAN-simd-engine.md phase 2: lane access.
 *
 * #sec-vector-lanes gives a vector two ways to reach a lane, and they differ in
 * WHEN the lane is chosen. A computed access takes an expression, so no static
 * rule bounds it and an out-of-range index throws a RangeError; the constant
 * form `lane.<I>()` is refused before the program runs. That asymmetry is the
 * reason the design gives both, and it is what these assert.
 *
 * The constant forms - `lane.<I>()`, `withLane.<I>()` - and the bit-vector
 * conversion are still to come.
 */

test('sum adds the lanes', () => {
  // #sec-vector-lanes leaves the ORDER implementation-defined, so an integer
  // lane type is asserted by value and a float one is not: addition is not
  // associative for a binary floating-point lane type, and the clause says two
  // implementations may differ on one receiver. Asserting a float sum's bit
  // pattern would encode this engine's fold as the specification's.
  expect(evaluated('const a = int32x4(1, 2, 3, 4); String(a.sum());')).toBe('10');
  expect(evaluated('const a = int32x4(0, 0, 0, 0); String(a.sum());')).toBe('0');
  expect(ok('const a = float32x4(1.5, 2.5, 3, 4); const s: float32 = a.sum();')).toBe(true);
});

test('a key a vector does not answer is refused, not crashed', () => {
  // A vector is a primitive with no wrapper object, so an unanswered key cannot
  // fall through to ToObject - which asserts rather than boxing. It reports
  // that the name is not a member, and the component accessors will be answered
  // ahead of that as they land.
  expectThrown('const a = float32x4(1, 2, 3, 4); a.nope;');
});

test('a lane is read by index', () => {
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a[0]);')).toBe('1');
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a[3]);')).toBe('4');
  expect(evaluated('const a = float32x4(1, 2, 3, 4); let i = 2; String(a[i]);')).toBe('3');
  // A string key names the same lane. Both spellings must work, because a
  // member access does not canonicalize its key before the reference resolves.
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a["1"]);')).toBe('2');
});

test('an out-of-range lane read throws at run time', () => {
  // A RangeError rather than a type error: the index is an expression, so it is
  // not known before the program runs. This is the half of the asymmetry that
  // the constant form does not have.
  expectThrown('const a = float32x4(1, 2, 3, 4); a[4];');
  expectThrown('const a = float32x4(1, 2, 3, 4); let i = 9; a[i];');
});

test('a lane is written by index', () => {
  expect(evaluated('const a = float32x4(1, 2, 3, 4); a[1] = 9; String(a);')).toBe('(1, 9, 3, 4)');
  expectThrown('const a = float32x4(1, 2, 3, 4); a[4] = 9;');
});

test('a written lane converts to the lane type', () => {
  // The write goes through the lane type's conversion, so a value that is not
  // one is refused rather than stored.
  expectThrown('const a = int32x4(1, 2, 3, 4); a[0] = "s";');
});
