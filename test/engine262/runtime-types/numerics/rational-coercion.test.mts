import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * #sec-numeric-types states Math over a rational exactly: "For a rational type
 * the result is exact, and a fixed-width result whose lowest-terms numerator or
 * denominator does not fit its `int.<N>` throws a *RangeError* exception."
 *
 * None of that is implemented. Without a `valueOf` the ordinary coercion found
 * `Object.prototype.valueOf`, which answers the object, and `ToNumber` made it
 * *NaN* - so `Math.abs(rational(-1, 2))` was `NaN`, as were `Math.max` and
 * `Math.sign` of a rational. A silent *NaN* is the one answer that is neither
 * right nor honest.
 *
 * A decimal already refuses in this position, and for the same reason, so the
 * two families now tell one story until the arithmetic of either is defined.
 * Refusing is a stopgap and says so: implementing the rows would be the fix,
 * and a partial implementation would claim more than it delivers.
 */

test('coercing a rational is refused rather than answered', () => {
  expectThrownKind('let r = rational(-1, 2); Math.abs(r);', 'TypeError');
  expectThrownKind('let a = rational(1, 2); let b = rational(1, 3); Math.max(a, b);', 'TypeError');
  expectThrownKind('let r = rational(-1, 2); Math.sign(r);', 'TypeError');
});

test('a decimal refuses in the same shape', () => {
  expectThrownKind("let d = decimal64('-2.5'); Math.abs(d);", 'TypeError');
});

test('everything a rational can already do is unchanged', () => {
  expect(evaluated('let r = rational(-1, 2); String(r);')).toBe('-1/2');
  expect(evaluated('let r = rational(-1, 2); String(r.numerator);')).toBe('-1');
  expect(evaluated('let r = rational(-1, 2); String(r.denominator);')).toBe('2');
  expect(evaluated('let r = rational(1, 2); String(r.reciprocal());')).toBe('2');
  // Rational arithmetic goes through the operators, which are defined.
  expect(evaluated('let a = rational(1, 2); let b = rational(1, 3); String(a + b);')).toBe('5/6');
  // And the conversion this session added still reads the exact value.
  expect(evaluated('String(rational(0.5));')).toBe('1/2');
});
