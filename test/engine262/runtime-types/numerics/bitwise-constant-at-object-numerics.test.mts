import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * Question BO: a decimal, a rational and a `float128` have no bitwise operator
 * and no shift, so one in a constant at such a type is computed as JavaScript
 * computes it, its operands having no contextual type, and its value is an
 * integer, which takes the type as a literal does. The arithmetic around it is
 * the type's. The whole expression was read in an `int32`, so `(6 | 1) / 2` at
 * a `decimal64` was 3, `(6 | 1) * 0.1` the double 0.7000000000000001, `-1 >>> 0`
 * -1 where JavaScript computes 4294967295, and `d * (0.5 | 0)` a TypeError when
 * it ran.
 */

test('the arithmetic around the operator is the type\'s', () => {
  expect(evaluated('const e: decimal64 = (6 | 1) / 2; String(e);')).toBe('3.5');
  expect(evaluated('const e: rational64 = (6 | 1) / 2; String(e);')).toBe('7/2');
  expect(evaluated('const e: float128 = (6 | 1) / 2; String(e);')).toBe('3.5');
  expect(evaluated('const e: decimal64 = (6 | 1) * 0.1; String(e);')).toBe('0.7');
  expect(evaluated('const e: decimal64 = (6 | 1) / 3; String(e);')).toBe('2.333333333333333');
  expect(evaluated('const e: rational64 = (6 | 1) / 3; String(e);')).toBe('7/3');
  expect(evaluated('const d: decimal64 = 1; String(d * ((6 | 1) / 2)) + " " + String(d * ((6 | 1) * 0.1));')).toBe('3.5 0.7');
});

test('the operator is JavaScript\'s, on Numbers', () => {
  expect(evaluated('const e: decimal64 = -1 >>> 0; const r: rational64 = -1 >>> 0; const q: float128 = -1 >>> 0; String(e) + " " + String(r) + " " + String(q);'))
    .toBe('4294967295 4294967295 4294967295');
  expect(evaluated('const d: decimal64 = 1; String(d * (0.5 | 0)) + " " + String(d * ((2 ** 31) | 0)) + " " + String(d * ((0.1 + 0.2) * 10 | 0));'))
    .toBe('0 -2147483648 3');
  // Its integer takes the type as a literal does: no `decimal32` is 1073741824.
  expectThrown('const e: decimal32 = 1 << 30;', '"1073741824" is not in the range of "decimal32"');
});

test('a named constant is its initializer beside a typed operand, as if inlined', () => {
  for (const type of ['decimal64', 'rational64', 'float128']) {
    expect(evaluated(`const K = 6 | 1; const d: ${type} = 2; String(d * K);`)).toBe('14');
  }
  expect(evaluated('const K = 1 << 31; const a: int64 = 0; String(a + K) + " " + String(a + (1 << 31));')).toBe('2147483648 2147483648');
  expect(evaluated('const K = 6 | 1; const b: bigint = 2n; String(b * K);')).toBe('14');
  // What the inlined spelling refuses, the named one does.
  expectStaticTypeError('const K = 2 ** 0.5; const d: decimal64 = 1; d * K;');
  expectStaticTypeError('const K = 1 << 10; const q: rational.<8> = 1; q * K;');
  expectStaticTypeError('const K = 2 ** 0.5; const a: uint8 = 1; a * K;');
});
