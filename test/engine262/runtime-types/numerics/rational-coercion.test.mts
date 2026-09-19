import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * #sec-numeric-library states the Math rows for every numeric family: "A
 * signature's declared return type is a boundary ... For a decimal type,
 * precision rounding is silent and a result outside the exponent range throws a
 * *RangeError* exception. For a rational type the result is exact."
 *
 * Neither family reached Math at all, and each failed differently. A decimal
 * answered "decimal arithmetic is not yet defined" - false, its operators being
 * fully defined - and a rational, having no `valueOf`, found
 * `Object.prototype.valueOf` and answered *NaN*, which is the one result that is
 * neither right nor honest.
 *
 * `abs`, `sign`, `max` and `min` need only negation and comparison, so they are
 * exact at every width and are implemented. The rows that ROUND - `trunc`,
 * `floor`, `ceil`, `round`, the transcendentals - are not, and refuse with a
 * message that says what is true: the value has no Number to be.
 */

test('the exact rows answer for a decimal, at the decimal type', () => {
  expect(evaluated("let d = decimal64('-2.50'); String(Math.abs(d));")).toBe('2.50');
  expect(evaluated("let d = decimal64('-2.50'); String(Reflect.typeOf(Math.abs(d)));")).toBe('decimal64');
  // The sign is A VALUE OF T, which is what the clause's table row says.
  expect(evaluated("let d = decimal64('-2.5'); String(Math.sign(d));")).toBe('-1');
  expect(evaluated("let d = decimal64('0'); String(Math.sign(d));")).toBe('0');
  expect(evaluated("let a = decimal64('2.5'); let b = decimal64('3.5'); String(Math.max(a, b));")).toBe('3.5');
  expect(evaluated("let a = decimal64('2.5'); let b = decimal64('3.5'); String(Math.min(a, b));")).toBe('2.5');
});

test('and for a rational, exactly', () => {
  expect(evaluated('let r = rational(-1, 2); String(Math.abs(r));')).toBe('1/2');
  expect(evaluated('let r = rational(-1, 2); String(Reflect.typeOf(Math.abs(r)));')).toBe('rational');
  expect(evaluated('let r = rational(-1, 2); String(Math.sign(r));')).toBe('-1');
  expect(evaluated('let a = rational(1, 2); let b = rational(1, 3); String(Math.max(a, b));')).toBe('1/2');
  expect(evaluated('let a = rational(1, 2); let b = rational(1, 3); String(Math.min(a, b));')).toBe('1/3');
});

test('a row that rounds is refused, and says why', () => {
  // Not "arithmetic is not yet defined" - the arithmetic is defined. What is
  // missing is a rounding rule for these rows, and the value has no Number to
  // fall back on.
  expectThrownKind("let d = decimal64('2.5'); Math.trunc(d);", 'TypeError');
  expectThrownKind('let r = rational(1, 2); Math.trunc(r);', 'TypeError');
  // A mixed pair is not one family, so it is not an exact row either.
  expectThrownKind("let d = decimal64('2.5'); let r = rational(1, 2); Math.max(d, r);", 'TypeError');
});

test('the other families are untouched', () => {
  expect(evaluated('String(Math.max(1, 5, 3));')).toBe('5');
  expect(evaluated('String(Math.abs((-5 := int32)));')).toBe('5');
  expect(evaluated('let f: float32 = -2.5; String(Math.abs(f));')).toBe('2.5');
});

test('everything a rational could already do is unchanged', () => {
  expect(evaluated('let r = rational(-1, 2); String(r);')).toBe('-1/2');
  expect(evaluated('let r = rational(-1, 2); String(r.numerator);')).toBe('-1');
  expect(evaluated('let r = rational(1, 2); String(r.reciprocal());')).toBe('2');
  expect(evaluated('let a = rational(1, 2); let b = rational(1, 3); String(a + b);')).toBe('5/6');
  expect(evaluated('String(rational(0.5));')).toBe('1/2');
});
