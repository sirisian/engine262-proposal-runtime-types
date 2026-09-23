import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-overloading-of-the-standard-library.
 *
 * "Where the array has a fixed extent and the index is a numeric literal ...
 * an index that is negative, not an integer, or not less than the extent is a
 * type error rather than the *RangeError* it would raise at run time."
 *
 * A negative index can only be written with a unary minus, and the check read
 * a bare `NumericLiteral` alone: `a[-1]` threw a RangeError at run time, and
 * `a[-1] = 2` completed without one. A signed literal, and a `const` bound to
 * one, now decide the index as a tuple's already did.
 */

test('a negative or out-of-range signed index is refused, read or written', () => {
  expectStaticTypeError('let a: [4].<uint8>; a[-1];');
  expectStaticTypeError('let a: [4].<uint8>; a[-1] = 2;');
  expectStaticTypeError('let a: [4].<uint8>; a[(-2)];');
  expectStaticTypeError('const i = -1; let a: [4].<uint8>; a[i];');
  expectStaticTypeError('const j = 4; let a: [4].<uint8>; a[j];');
});

test('in-range indices and dynamic arrays are unchanged', () => {
  expect(evaluated('let a: [4].<uint8>; a[3] = 7; String(a[3]) + String(a[+0]);')).toBe('70');
  expect(evaluated('const k = 2; let a: [4].<uint8>; a[k] = 5; String(a[k]);')).toBe('5');
  expect(evaluated('let d: [].<uint8> = [1]; let r = "no"; try { d[-1]; } catch (e) { r = "run time"; } r;')).toBe('run time');
});
