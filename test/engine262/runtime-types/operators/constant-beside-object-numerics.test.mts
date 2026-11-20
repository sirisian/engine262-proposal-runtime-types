import { expect, test } from 'vitest';
import { evaluated, expectThrown, expectThrownKind } from '../harness.mts';

/**
 * Question BN: beside a decimal, a rational or a `float128` whose type is seen
 * only when the expression runs, a named constant or arithmetic over constants
 * takes the type as a literal does (#sec-arithmetic-never-promotes: "its value
 * takes the type then, as a literal's does, or a RangeError is thrown where the
 * type has no such value. That value is read exactly, as a literal's is"). BA
 * gave a literal that reading; a constant stayed the Number it evaluates to,
 * and each was a TypeError where an integer and typed code took it: `a * (1 +
 * 2)` for an `a` holding a `decimal64` 2 threw, and is 6 under `a: decimal64`.
 */

const U = (value: string, body: string) => `function f(a) { return ${body}; } String(f(${value}));`;

test('a constant takes the type of the value beside it', () => {
  expect(evaluated(U('decimal64(2)', 'a * (1 + 2)'))).toBe('6');
  expect(evaluated(U('decimal64(2)', 'a + (0.1 + 0.2)'))).toBe('2.3');
  expect(evaluated(U('decimal64(2)', 'a * (7 / 2)'))).toBe('7.0');
  // The cohort typed code gives it, from the digits.
  expect(evaluated(U('decimal64(1)', 'a * (0.10 + 0.20)'))).toBe('0.30');
  expect(evaluated(U('rational64(1)', 'a + 1 / 3'))).toBe('4/3');
  expect(evaluated(U('float128(0)', 'a + 1 / 3'))).toBe('0.3333333333333333333333333333333333');
  expect(evaluated('const K = 1 + 2; function f(a) { return a * K; } String(f(decimal64(2))) + " " + String(f(rational64(2))) + " " + String(f(float128(2)));')).toBe('6 6 6');
  expect(evaluated(U('decimal64(1)', 'a * -(1 + 2)'))).toBe('-3');
  // A bitwise operator is JavaScript's, and its integer is taken exactly
  // (Question BO).
  expect(evaluated(U('decimal64(2)', 'a * (6 | 1)'))).toBe('14');
  expect(evaluated(U('rational64(2)', 'a * ((6 | 1) / 2)'))).toBe('7');
  expect(evaluated(U('float128(1)', 'a * (-1 >>> 0)'))).toBe('4294967295');
});

test('in a comparison, an equality, a case label and Object.is', () => {
  expect(evaluated(U('decimal64(2)', 'a === 1 + 1'))).toBe('true');
  expect(evaluated(U('rational64(2)', 'a < 1 + 2'))).toBe('true');
  expect(evaluated(U('float128(3)', 'Object.is(a, 1 + 2)'))).toBe('true');
  expect(evaluated('function f(a) { switch (a) { case 1 + 1: return "two"; } return "no"; } f(rational64(2));')).toBe('two');
});

test('a constant the type cannot hold is a RangeError, and equal to nothing', () => {
  // Its `/` is the exact quotient, which no decimal holds for a third.
  expectThrown(U('decimal64(1)', 'a + 1 / 3'), '"1 / 3" is not in the range of "decimal64"');
  expectThrownKind(U('rational64(1)', 'a * (1e30 * 1)'), 'RangeError');
  expectThrown(U('float64(1)', 'a * -(1e308 * 10)'), '"-(1e308 * 10)" is not in the range of "float64"');
  expectThrownKind(U('float32(1)', 'a * (1e300 * 1e300)'), 'RangeError');
  expect(evaluated(U('decimal64(1)', 'a === 1 / 3'))).toBe('false');
  // `1 / 0` has no exact value, and keeps the infinity the type has.
  expect(evaluated(U('float64(1)', 'a * (1 / 0)'))).toBe('Infinity');
});

test('a binding adopts nothing, as before', () => {
  expectThrownKind('function f(a, n) { return a * n; } f(decimal64(2), 3);', 'TypeError');
});
