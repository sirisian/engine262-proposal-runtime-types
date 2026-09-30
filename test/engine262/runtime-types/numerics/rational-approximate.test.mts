import { expect, test } from 'vitest';
import { evaluated, expectThrown, expectThrownKind } from '../harness.mts';

/**
 * `rational64.approximate(f, maxDenominator)` (#sec-rational-types) returns the value of the type nearest the
 * Number `f` whose denominator does not exceed the bound, with the worked example
 * `rational64.approximate(Math.PI, 1000); // 355/113`. Distinct from `rational64(f)`, which is the float's
 * EXACT dyadic value and can need a denominator of 2^52. This is what a program wants when it has a
 * measurement and a bound. The static is spelled `approximate` on the lowercase type, beside
 * `rational64.parse`; they are the same object.
 */

test('the documented example', () => {
  expect(evaluated('String(rational64.approximate(Math.PI, 1000));')).toBe('355/113');
});

test('a tighter bound gives an earlier convergent', () => {
  expect(evaluated('String(rational64.approximate(Math.PI, 100));')).toBe('311/99');
  expect(evaluated('String(rational64.approximate(Math.PI, 10));')).toBe('22/7');
  expect(evaluated('String(rational64.approximate(Math.PI, 1));')).toBe('3');
});

test('a value the bound can hold exactly is exact', () => {
  expect(evaluated('String(rational64.approximate(0.5, 1000));')).toBe('1/2');
  expect(evaluated('String(rational64.approximate(5, 100));')).toBe('5');
  expect(evaluated('String(rational64.approximate(0, 100));')).toBe('0');
  // A third is not dyadic, so `rational64(1/3)` would need a huge denominator;
  // bounded, it is just 1/3.
  expect(evaluated('String(rational64.approximate(1 / 3, 1000));')).toBe('1/3');
});

test('the sign is carried', () => {
  expect(evaluated('String(rational64.approximate(-Math.PI, 1000));')).toBe('-355/113');
});

test('a source or bound with no answer is refused', () => {
  expectThrown('rational64.approximate(Infinity, 100);', 'is not in the range of');
  expectThrown('rational64.approximate(1.5, 0);', 'is not in the range of');
});

test('the neighbouring statics and the exact form are untouched', () => {
  expect(evaluated('String(rational64.parse("1/3"));')).toBe('1/3');
  expect(evaluated('String(rational64(0.5));')).toBe('1/2');
});

test('approximation converts its source and bound in order', () => {
  expect(evaluated('let log = ""; const x = { valueOf() { log += "x"; return 0.5; } }; const bound = { valueOf() { log += "b"; return 10; } }; String(rational64.approximate(x, bound)) + ":" + log;')).toBe('1/2:xb');
});

test('approximation propagates abrupt numeric conversions', () => {
  expectThrownKind('rational64.approximate(Symbol(), 10);', 'TypeError');
  expectThrownKind('rational64.approximate(0.5, Symbol());', 'TypeError');
  expect(evaluated('let log = ""; const x = { valueOf() { throw new Error("source"); } }; const bound = { valueOf() { log += "b"; return 10; } }; try { rational64.approximate(x, bound); } catch (e) { log += e.message; } log;')).toBe('source');
});
