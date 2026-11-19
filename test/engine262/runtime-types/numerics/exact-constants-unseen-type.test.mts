import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * A constant keeps its exact value where the checker cannot see the type it lands at.
 *
 * Where the type is written, a literal is read from its source text and a constant is computed in
 * the type. Three places lost that where the type is known only when the line runs:
 *
 * - a member of an object literal converted through a type parameter, `{ n: 9007199254740993 } :=
 *   T` with `T` a class with a `uint64` field, held 9007199254740992;
 * - a dividing constant converted through a type parameter at `float128` or `decimal128`, `1 / 3 :=
 *   T`, held the double's third written out to 34 digits;
 * - `x += 2 ** 53 + 1` for a `uint64` held by an untyped `x` added ...992, where `x + (2 ** 53 +
 *   1)` adds ...993.
 */

test('a member literal through a type parameter is read from its text', () => {
  const C = 'class C { n: uint64 = 0; d: decimal128 = 0; }';
  expect(evaluated(`${C} function g<T: type>(): T { return { n: 9007199254740993 } := T; } String(g.<C>().n);`)).toBe('9007199254740993');
  expect(evaluated(`${C} String(({ n: 9007199254740993 } := C).n);`)).toBe('9007199254740993');
  expect(evaluated(`${C} function g<T: type>(): T { return { d: 0.1 } := T; } String(g.<C>().d);`)).toBe('0.1');
});

test('a dividing constant through a type parameter is computed in the type', () => {
  expect(evaluated('function g<T: type>(): T { return 1 / 3 := T; } String(g.<float128>()) + " " + String(g.<decimal128>());'))
    .toBe('0.3333333333333333333333333333333333 0.3333333333333333333333333333333333');
  expect(evaluated('String(1 / 3 := float128) + " " + String(1 / 3 := decimal128);'))
    .toBe('0.3333333333333333333333333333333333 0.3333333333333333333333333333333333');
});

test('a constant operand of a compound assignment beside an integer of unseen type is exact', () => {
  expect(evaluated('function f(x) { x += 2 ** 53 + 1; return x; } String(f(uint64(0)));')).toBe('9007199254740993');
  expect(evaluated('function f(x) { return x + (2 ** 53 + 1); } String(f(uint64(0)));')).toBe('9007199254740993');
  expect(evaluated('function f(x) { x += 2; return x; } String(f(uint8(3)));')).toBe('5');
});
