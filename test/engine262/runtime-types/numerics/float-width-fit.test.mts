import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

/**
 * `fitsNumericType` answers whether a type HOLDS a value, and its float branch
 * answered *true* for every float name - so the predicate was a no-op on that
 * family and each caller had to catch an overflow itself, or silently did not.
 *
 * It now asks what its callers mean: a float holds a finite value where rounding
 * to the width keeps it finite. Every finite Number is a `float128` value, the
 * format being strictly wider than binary64 in both significand and exponent; no
 * `float16` holds 1e300.
 *
 * This is a MEMBERSHIP question and not a conversion one, which is why the two
 * still part company: #table-numeric-conversions says a finite source outside a
 * float's range "becomes an infinity of the same sign", and a conversion does
 * exactly that.
 */

test('a conversion still overflows to an infinity', () => {
  expect(evaluated('let n = 1e300; String(float16(n));')).toBe('Infinity');
  expect(evaluated('let n = 1e300; String(float32(n));')).toBe('Infinity');
  expect(evaluated('let n = 1e300; String((n := float16));')).toBe('Infinity');
});

test('a boundary refuses what a conversion overflows', () => {
  expectThrownKind('let n: any = 1e300; let f: float16 = n;', 'RangeError');
  // And an in-range value rounds, as it always did.
  expect(evaluated('let n: any = 0.1; let f: float16 = n; String(f);')).toBe('0.0999755859375');
});

test('parse and a typed JSON token refuse an out-of-range literal', () => {
  expectThrownKind("float16.parse('1e300');", 'RangeError');
  expectThrownKind("JSON.parse.<float16>('1e300');", 'TypeError');
  expect(evaluated("String(float16.parse('0.1'));")).toBe('0.0999755859375');
  expect(evaluated("String(JSON.parse.<float16>('0.1'));")).toBe('0.0999755859375');
});

test('a Math literal the carried float cannot hold matches no signature', () => {
  // Which is what that call site's own comment asks for: "a plain numeric
  // argument beside a typed one is a literal and takes the parameter's type, so
  // one it cannot represent matches no signature".
  expectStaticTypeError('let f: float16 = 1; Math.max(f, 1e300);');
  expect(evaluated('let f: float16 = 1; String(Math.max(f, 2));')).toBe('2');
});

test('float128 holds every finite Number', () => {
  expect(evaluated('let n = 1e300; String(String(float128(n)).length > 0);')).toBe('true');
  expect(evaluated('let n: any = 1e300; let f: float128 = n; String(String(f).length > 0);')).toBe('true');
});
