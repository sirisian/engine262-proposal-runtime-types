import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * CONVERSIONS OUT OF A RATIONAL. rational.md specifies them:
 *
 *   To a float: `float64(r)` is `numerator / denominator` rounded to the nearest
 *   `float64`. This is the lossy step, and it is visible.
 *   To an integer: `int64(r)` truncates toward zero.
 *
 * Neither existed. Every numeric target refused a rational source, so a program
 * could compute exactly and never get a value back out - the type was closed in
 * one direction while the document named both. `ToNumber` is no help: a rational
 * deliberately has no Number value, and says so.
 *
 * The lossy step is the point of the design, not a defect: an exact fraction
 * reaching a float rounds, and the program wrote the conversion that says so.
 */

test('to a float, rounded', () => {
  expect(evaluated('const r: rational = 1 / 3; String(float64(r));')).toBe('0.3333333333333333');
  expect(evaluated('const r: rational = 1 / 2; String(float64(r));')).toBe('0.5');
  // At a narrower width the rounding is the width's, not float64's.
  expect(evaluated('const r: rational = 1 / 3; String(float32(r));')).toBe('0.3333333432674408');
});

test('to an integer, truncating toward zero', () => {
  expect(evaluated('const r: rational = 7 / 2; String(int64(r));')).toBe('3');
  expect(evaluated('const r: rational = 5 / 1; String(int32(r));')).toBe('5');
  // Toward zero, not toward negative infinity - the same rule `/` follows at an
  // integer context.
  expect(evaluated('const r: rational = -7 / 2; String(int64(r));')).toBe('-3');
});

test('an integer target still checks range', () => {
  // Truncating does not excuse a result the type cannot hold.
  expectThrown('const r: rational = 300 / 1; uint8(r);', 'is not in the range of');
});

test('the inbound direction and the identity are unchanged', () => {
  expect(evaluated('const r: rational = 1 / 2; String(rational(float64(r)));')).toBe('1/2');
  expect(evaluated('const r: rational = 1 / 3; String(rational(r));')).toBe('1/3');
  expect(evaluated('String(rational(0.5));')).toBe('1/2');
});

test('other sources are untouched', () => {
  expect(evaluated('String(float64(1.5));')).toBe('1.5');
  expectThrown('float64("s");', 'not a conversion source');
});
