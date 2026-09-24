import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-which-operations-each-family-defines (plan OQ3 C).
 *
 * An update steps a value by its family's unit. A rational and a decimal step
 * by one in their own type; the complex numbers, which the table leaves
 * unordered, have no step, and an update of one is a type error.
 *
 * Neither held. `c++` on a `complex128` went through ToNumeric and stored
 * NaN+0i, silently, and `r++` on a `rational` threw at run time because a
 * rational has no Number value.
 */

test('an update of a complex number is refused', () => {
  expectStaticTypeError('let c: complex128 = 1 + 2i; c++;');
  expectStaticTypeError('let c: complex128 = 1 + 2i; --c;');
  // Where the checker cannot see the type, the run time refuses it.
  expectThrownKind('let c: any = 1 + 2i; c++;', 'TypeError');
});

test('rational and decimal numbers step by one in their own type', () => {
  expect(evaluated('let r: rational = 1 / 3; r++; String(r);')).toBe('4/3');
  expect(evaluated('let r: rational = 1 / 3; String(--r);')).toBe('-2/3');
  expect(evaluated('let r: rational = 1 / 3; String(r++) + " " + String(r);')).toBe('1/3 4/3');
  expect(evaluated('let d: decimal128 = (1.5 := decimal128); d++; String(d);')).toBe('2.5');
  expect(evaluated('let d: decimal128 = (1.5 := decimal128); String(--d);')).toBe('0.5');
});

test('other numeric updates are unchanged', () => {
  expect(evaluated('let n = 1; n++; let u: uint8 = 1; u++; String(n) + String(u);')).toBe('22');
});
