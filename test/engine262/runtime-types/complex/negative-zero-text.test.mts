import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-which-operations-each-family-defines (a complex defines `toString`).
 *
 * A complex's text writes a negative-zero component as `-0`. `String(-0)` is "0", so
 * the sign has to be written deliberately: `-(3 := complex64)` is `-3-0i` and
 * `complex(1, -0)` is `1-0i`, not the malformed `-30i` and `10i` that dropping it
 * gives. A -0 real part declines the `4i` shorthand, so `complex(-0, 0)` is `-0+0i`.
 *
 * Unspecified: the specification gives a complex a `toString` but does not fix its
 * format. These tests pin the engine's choice: the imaginary part is suffixed `i`, a
 * +0 real part is omitted when the imaginary part stands alone, and a signed zero
 * keeps its sign, as it does in Python's complex repr (a different spelling).
 */

const text = (expr: string) => evaluated(`String(${expr});`);

test('a negative-zero imaginary part keeps its sign', () => {
  expect(text('-(3 := complex64)')).toBe('-3-0i');
  expect(text('complex(1, -0)')).toBe('1-0i');
  expect(text('complex(0, -0)')).toBe('-0i');
});

test('a negative-zero real part keeps its sign', () => {
  expect(text('complex(-0, 0)')).toBe('-0+0i');
  expect(text('complex(-0, -0)')).toBe('-0-0i');
});

test('the rest of the format is unchanged', () => {
  // The shorthand for a +0 real part follows the imaginary-literal syntax.
  expect(text('complex(0, 1)')).toBe('1i');
  expect(text('complex(0, 0)')).toBe('0i');
  expect(text('Math.sqrt(complex(-1))')).toBe('1i');
  expect(text('(3 := complex64)')).toBe('3+0i');
  expect(text('complex(1.5, -2.5)')).toBe('1.5-2.5i');
  expect(text('complex(NaN, -Infinity)')).toBe('NaN-Infinityi');
});
