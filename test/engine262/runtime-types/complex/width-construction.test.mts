import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * A COMPLEX AT A NAMED WIDTH IS CONSTRUCTED FROM ITS PAIR, as the bare name is.
 *
 * `sec-type-names` lists `complex64(1, 2)` beside `decimal128.parse("1.0")` and
 * `float32x4(1, 2, 3, 4)` as "how those values are CREATED".
 *
 * Only the bare `complex` was bound to the pair constructor. A width name is
 * bound to its Type Object, whose call is a CONVERSION and reads one argument,
 * so `complex128(1, 2)` returned **`1+0i`** - a well-formed complex with the
 * wrong value, no error and no warning - while `complex(1, 2)` and
 * `complex128.parse('1+2i')` both gave `1+2i`. Two ways of building one value
 * disagreed, and the quiet one was wrong.
 *
 * That silence is why this is pinned at both widths and on the imaginary part
 * directly: a test that only checked `complex128(1, 2)` prints as `1+0i` would
 * have passed a wrong value as readily as a right one.
 */

test('a pair at a named width keeps both parts', () => {
  expect(evaluated('String(complex128(1, 2));')).toBe('1+2i');
  expect(evaluated('String(complex64(1, 2));')).toBe('1+2i');
  expect(evaluated('String(complex128(3, -4));')).toBe('3-4i');
});

test('the imaginary part is really there, not just displayed', () => {
  expect(evaluated('String(complex128(3, 4).imaginary);')).toBe('4');
  expect(evaluated('String(complex64(3, 4).imaginary);')).toBe('4');
});

test('one argument still converts, which is what a width name meant before', () => {
  expect(evaluated('String(complex128(5));')).toBe('5+0i');
  expect(evaluated('const c = complex(1, 2); String(complex128(c));')).toBe('1+2i');
});

test('the bare constructor and parse are unchanged', () => {
  expect(evaluated('String(complex(1, 2));')).toBe('1+2i');
  expect(evaluated('String(complex(3, 4).imaginary);')).toBe('4');
  expect(evaluated("String(complex128.parse('3-2i'));")).toBe('3-2i');
});
