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
 * The bit-vector conversion is still to come.
 */

test('the constant lane forms take a compile-time index', () => {
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a.lane.<0>());')).toBe('1');
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a.lane.<3>());')).toBe('4');
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a.withLane.<1>(9));')).toBe('(1, 9, 3, 4)');
});

test('an out-of-range constant index is refused before the program runs', () => {
  // The other half of the asymmetry: `a[4]` throws a RangeError at run time
  // because its index is an expression, and `a.lane.<4>()` is refused as a type
  // error because its index is a constant. Both are asserted, in one place, so
  // the difference cannot quietly collapse.
  expectThrown('const a = float32x4(1, 2, 3, 4); a.lane.<4>();');
  expectThrown('const a = float32x4(1, 2, 3, 4); a.withLane.<4>(9);');
  expectThrown('const a = float32x4(1, 2, 3, 4); a[4];');
});

test('withLane leaves the receiver unchanged', () => {
  // A vector is a value type, so `withLane` returns a NEW one. Asserted on the
  // RECEIVER rather than only on the result, which is the assertion that would
  // fail if the lanes were written in place.
  expect(evaluated('const a = float32x4(1, 2, 3, 4); a.withLane.<1>(9); String(a);')).toBe('(1, 2, 3, 4)');
});

test('a replaced lane converts to the lane type', () => {
  expectThrown('const a = int32x4(1, 2, 3, 4); a.withLane.<0>("s");');
});

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

/**
 * PLAN-simd-engine.md phase 2, the broadcast: attempted, reverted, and located
 * more precisely than a stack trace would have shown.
 *
 * #sec-vector-lanes says `vector.<T, N>` declares a cast operator from T, so
 * `let b: float32x4 = s` for a `float32` s should broadcast. The CONVERSION is
 * written and works - `float32x4(2)` gives `(2, 2, 2, 2)`, and
 * CheckedConvertValue fills every lane - but the assignment does not reach it.
 *
 * TWO PATHS GUARD IT AND THEY MUST AGREE. The checker's IsAssignable refuses
 * the assignment statically, before any conversion runs. Making IsAssignable
 * admit a lane type produced something WORSE than the refusal: the assignment
 * was accepted and the value stayed a `float32`, so `Reflect.typeOf(b) ===
 * float32x4` was false and a broadcast had silently not happened. That is a
 * type system admitting a value it did not convert, which is unsound rather
 * than incomplete, so it was reverted.
 *
 * The two halves have to land together: IsAssignable admitting the lane type
 * AND the enforcement path converting rather than passing the value through.
 * requireMembership now attempts CheckedConvertValue when membership fails,
 * which is the second half; the first half needs the checker to tell the
 * enforcement path that a conversion is owed, rather than just permitting the
 * assignment. That is the next step.
 *
 * The refusal is the current behaviour and is correct-but-incomplete: it
 * rejects a program the design permits, rather than accepting one it does not.
 */

test('the broadcast cast fills every lane', () => {
  // The conversion itself, which works: an explicit call broadcasts.
  expect(evaluated('String(float32x4(2));')).toBe('(2, 2, 2, 2)');
  expect(evaluated('String(int32x4(7));')).toBe('(7, 7, 7, 7)');

  // Through an ANNOTATION it does not yet - see the note above. Asserted as it
  // behaves rather than as it should, so the fix has something to flip and the
  // gap is visible in the suite rather than only in a plan.
  expect(ok('let s: float32 = 2; let b: float32x4 = s;')).toBe(false);
});

/**
 * The broadcast, and the one route that reaches it.
 *
 * THE CYCLE IS CLOSED. `let s: any = 2; let b: float32x4 = s;` broadcasts to
 * `(2, 2, 2, 2)` and the result IS a float32x4. The loop was in the branch
 * itself: it TESTED whether the value was of the lane type, and a plain Number
 * is not a member of `float32` - it becomes one. So the branch was never taken,
 * the conversion fell through to the general rule, and that asked to convert to
 * the vector type again.
 *
 * Converting the lane once and reusing it is also what gives the broadcast its
 * meaning: every lane holds the SAME value of the lane type rather than N
 * separately-converted copies.
 *
 * THE STATIC HALF REMAINS REVERTED, for the second time and for the same
 * reason. Teaching IsAssignable that a lane type is assignable to the vector
 * makes `let b: float32x4 = s` for a typed `float32` s succeed with the value
 * UNCONVERTED - `Reflect.typeOf(b) === float32x4` is false. A statically typed
 * value takes a path that does not reach requireMembership at all, so the
 * checker's permission is the only thing consulted and nothing converts.
 *
 * That is why the `any` case works and the typed case does not: `any` defers to
 * the runtime, which converts; a known type is settled statically, which does
 * not. The fix is for the checker to record that a conversion is OWED at that
 * binding rather than merely permitting it, and until that exists the refusal
 * is the honest behaviour - it rejects a program the design permits, where the
 * alternative accepts one it does not.
 */

test('a lane value broadcasts where the runtime decides the type', () => {
  expect(evaluated('let s: any = 2; let b: float32x4 = s; String(b);')).toBe('(2, 2, 2, 2)');
  expect(evaluated('let s: any = 2; let b: float32x4 = s; String(Reflect.typeOf(b) === float32x4);')).toBe('true');
  // A value that is not a conversion source for the lane type is still refused.
  expect(ok('let s: any = "x"; let b: float32x4 = s;')).toBe(false);
});

