import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * `Object.is` on a value type class.
 *
 * #sec-typed-classes makes an instance of a value type class a VALUE:
 * "every one of its fields has a type that is a value type ... assigning one
 * copies it". #sec-value-types: "two values of the same value type that are the
 * same value are indistinguishable".
 *
 * `IsStrictlyEqual` and `SameValueZero` compared such instances field-wise;
 * `SameValue` did not, so `_a_ === _b_` answered *true* where
 * `Object.is(_a_, _b_)` answered *false* for the same pair.
 *
 * Nearly unreachable while assignment ALIASES, since most comparisons are then
 * of a thing with itself. Reached immediately once assignment COPIES, which
 * #sec-value-type-copying requires - so this is fixed BEFORE the copy rather
 * than after, to avoid a window in which the two disagree about every copied
 * value.
 */

const V = 'class P { x: uint8 = 0; } ';

test('Object.is compares a value type class field-wise, as === does', () => {
  expect(evaluated(`${V} const a = new P(); a.x = 1; const b = new P(); b.x = 1; String(Object.is(a, b));`)).toBe('true');
  expect(evaluated(`${V} const a = new P(); a.x = 1; const b = new P(); b.x = 2; String(Object.is(a, b));`)).toBe('false');
  // The two operations now agree, which is the defect.
  expect(evaluated(`${V} const a = new P(); a.x = 1; const b = new P(); b.x = 1; String((a === b) === Object.is(a, b));`)).toBe('true');
});

test('nothing else changes', () => {
  // A class that is NOT a value type class - `string` is not a value type, so
  // #sec-typed-classes does not make its instances values.
  expect(evaluated('class Q { s: string = ""; } const a = new Q(); const b = new Q(); String(Object.is(a, b));')).toBe('false');
  expect(evaluated('const a = { x: 1 }; const b = { x: 1 }; String(Object.is(a, b));')).toBe('false');
  // `Object.is`'s own distinguishing cases are untouched.
  expect(evaluated('String(Object.is(NaN, NaN));')).toBe('true');
  expect(evaluated('String(Object.is(0, -0));')).toBe('false');
  expect(evaluated('String(Object.is("a", "a")) + String(Object.is(1, 1));')).toBe('truetrue');
});
