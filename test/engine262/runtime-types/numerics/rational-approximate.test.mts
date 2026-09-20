import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * `rational.approximate(f, maxDenominator)`.
 *
 * rational.md: "For a bounded approximation, `rational.approximate(f,
 * maxDenominator)` returns the closest rational whose denominator does not
 * exceed the bound, by the continued-fraction expansion", with the worked
 * example `rational.approximate(Math.PI, 1000); // 355/113`.
 *
 * Distinct from `rational(f)`, which is the float's EXACT dyadic value and can
 * need a denominator of 2^52. This is what a program wants when it has a
 * measurement and a bound.
 *
 * The document spells this `Rational.approximate` in its two mentions while
 * spelling the neighbouring static `rational.parse`; they are the same object,
 * and the lowercase form is the one the type carries.
 */

test('the documented example', () => {
  expect(evaluated('String(rational.approximate(Math.PI, 1000));')).toBe('355/113');
});

test('a tighter bound gives an earlier convergent', () => {
  expect(evaluated('String(rational.approximate(Math.PI, 100));')).toBe('311/99');
  expect(evaluated('String(rational.approximate(Math.PI, 10));')).toBe('22/7');
  expect(evaluated('String(rational.approximate(Math.PI, 1));')).toBe('3');
});

test('a value the bound can hold exactly is exact', () => {
  expect(evaluated('String(rational.approximate(0.5, 1000));')).toBe('1/2');
  expect(evaluated('String(rational.approximate(5, 100));')).toBe('5');
  expect(evaluated('String(rational.approximate(0, 100));')).toBe('0');
  // A third is not dyadic, so `rational(1/3)` would need a huge denominator;
  // bounded, it is just 1/3.
  expect(evaluated('String(rational.approximate(1 / 3, 1000));')).toBe('1/3');
});

test('the sign is carried', () => {
  expect(evaluated('String(rational.approximate(-Math.PI, 1000));')).toBe('-355/113');
});

test('a source or bound with no answer is refused', () => {
  expectThrown('rational.approximate(Infinity, 100);', 'is not in the range of');
  expectThrown('rational.approximate(1.5, 0);', 'is not in the range of');
});

test('the neighbouring statics and the exact form are untouched', () => {
  expect(evaluated('String(rational.parse("1/3"));')).toBe('1/3');
  expect(evaluated('String(rational(0.5));')).toBe('1/2');
});
