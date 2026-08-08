import { test, expect } from 'vitest';
import { evaluated, expectThrown, runFlagOff } from '../harness.mts';

/**
 * Spec: #sec-rational-types (Rational Types); design: rational.md.
 *
 * A rational is an exact fraction kept in canonical form (reduced to lowest
 * terms, denominator strictly positive, zero as 0/1), so structural equality is
 * mathematical equality and a rational serves as a Map or Set key by value. It is
 * constructed from parts, its arithmetic is exact and returned canonical, its
 * order is exact, and `rational` is a usable type name. The value is backed by a
 * pair of arbitrary-precision integers, so this core has no overflow.
 *
 * Deferred with the rest of the extension, each needing a facility another part
 * supplies: the fixed-width `rational.<N>` and its overflow RangeError, the
 * `1/3`-in-a-rational-context literal sugar (context-directed evaluation the
 * engine does not do for a compound expression), the float and integer
 * conversions (`float64(r)`, `int64(r)`, `rational(f)`, `Rational.approximate`),
 * the Math overloads, and the sibling complex and decimal value types.
 */

// -- construction, canonical form ---------------------------------------------
test('a rational is constructed from a numerator and denominator', () => {
  expect(evaluated('rational(3, 4).toString();')).toBe('3/4');
  expect(evaluated('rational(5).toString();')).toBe('5');
  expect(evaluated('typeof rational(1, 2);')).toBe('object');
});

test('a rational is reduced to lowest terms', () => {
  expect(evaluated('rational(2, 4).toString();')).toBe('1/2');
  expect(evaluated('rational(6, 12).toString();')).toBe('1/2');
  expect(evaluated('String(rational(2, 4).numerator);')).toBe('1');
  expect(evaluated('String(rational(2, 4).denominator);')).toBe('2');
});

test('the sign is normalized onto the numerator', () => {
  expect(evaluated('rational(1, -3).toString();')).toBe('-1/3');
  expect(evaluated('String(rational(1, -3).denominator);')).toBe('3');
  expect(evaluated('rational(0, 5).toString();')).toBe('0');
});

test('a zero denominator is a RangeError', () => {
  expectThrown('rational(1, 0);');
});

// -- exact arithmetic ---------------------------------------------------------
test('addition, subtraction, multiplication, and division are exact and canonical', () => {
  expect(evaluated('let a = rational(1, 6); let b = rational(1, 3); (a + b).toString();')).toBe('1/2');
  expect(evaluated('let a = rational(1, 2); let b = rational(1, 3); (a - b).toString();')).toBe('1/6');
  expect(evaluated('let a = rational(1, 6); let b = rational(1, 3); (a * b).toString();')).toBe('1/18');
  expect(evaluated('let a = rational(1, 6); let b = rational(1, 3); (b / a).toString();')).toBe('2');
});

test('three thirds sum to exactly one', () => {
  // the property a float cannot hold
  expect(evaluated('let t = rational(1, 3); ((t + t) + t).toString();')).toBe('1');
});

test('an integer power is exact, and a negative power inverts', () => {
  expect(evaluated('(rational(2, 3) ** rational(3, 1)).toString();')).toBe('8/27');
  expect(evaluated('(rational(2, 3) ** rational(-1, 1)).toString();')).toBe('3/2');
});

test('division by a zero rational is a RangeError', () => {
  expectThrown('rational(1, 2) / rational(0, 1);');
});

test('a non-integer exponent is a TypeError', () => {
  expectThrown('rational(2, 3) ** rational(1, 2);');
});

test('reciprocal inverts, and the reciprocal of zero is a RangeError', () => {
  expect(evaluated('rational(2, 3).reciprocal().toString();')).toBe('3/2');
  expectThrown('rational(0, 1).reciprocal();');
});

// -- equality is structural (canonical) ---------------------------------------
test('two rationals are equal exactly when they are the same canonical value', () => {
  expect(evaluated('String(rational(1, 2) == rational(2, 4));')).toBe('true');
  expect(evaluated('String(rational(1, 2) === rational(2, 4));')).toBe('true');
  expect(evaluated('String(rational(1, 2) == rational(1, 3));')).toBe('false');
  expect(evaluated('String(rational(1, 2) != rational(1, 3));')).toBe('true');
});

test('a rational serves as a Map or Set key by value', () => {
  expect(evaluated('let s = new Set(); s.add(rational(1, 2)); s.add(rational(50, 100)); String(s.size);')).toBe('1');
  expect(evaluated('let m = new Map(); m.set(rational(1, 2), "x"); String(m.get(rational(2, 4)));')).toBe('x');
  expect(evaluated('let s = new Set(); s.add(rational(1, 2)); s.add(rational(1, 3)); String(s.size);')).toBe('2');
});

// -- exact total order --------------------------------------------------------
test('the order is exact', () => {
  expect(evaluated('String(rational(1, 3) < rational(1, 2));')).toBe('true');
  expect(evaluated('String(rational(1, 2) < rational(1, 3));')).toBe('false');
  expect(evaluated('String(rational(1, 2) <= rational(2, 4));')).toBe('true');
  expect(evaluated('String(rational(2, 3) > rational(1, 2));')).toBe('true');
  expect(evaluated('String(rational(1, 2) >= rational(1, 2));')).toBe('true');
});

// -- the harmonic example -----------------------------------------------------
test('an exact harmonic partial sum', () => {
  expect(evaluated('let sum = rational(0, 1); for (let k = 1; k <= 4; ++k) { sum = sum + rational(1, k); } sum.toString();')).toBe('25/12');
  expect(evaluated('let sum = rational(0, 1); for (let k = 1; k <= 4; ++k) { sum = sum + rational(1, k); } String(sum.numerator) + "," + String(sum.denominator);')).toBe('25,12');
});

// -- Range as a type ----------------------------------------------------------
test('rational is a usable type name', () => {
  expect(evaluated('let r: rational = rational(3, 4); r.toString();')).toBe('3/4');
});

test('a non-rational value is not assignable to rational', () => {
  expectThrown('let r: rational = 5; "ok";');
  expectThrown('let r: rational = "abc"; "ok";');
});

// -- feature off --------------------------------------------------------------
test('rational does not exist with the feature off', () => {
  expect((runFlagOff('typeof rational;') as { Type: string, Value: { stringValue?(): string } }).Value.stringValue?.()).toBe('undefined');
});
