import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * A complex's text writes a negative-zero component as `-0`.
 *
 * The formatter already treated -0 as a sign worth keeping - it declines the
 * `4i` shorthand for a -0 real part, and a -0 imaginary part takes the branch
 * that writes no `+` and relies on the number's own text for the `-` - but
 * `String(-0)` is "0", so the sign was dropped and the text malformed:
 * `-(3 + 0i)` printed `-30i` and `complex(1, -0)` printed `10i`.
 *
 * The result is Python's complex repr exactly: `(-3-0j)`, `(1-0j)`, `-0j`,
 * `(-0+0j)`, with the same shorthand for a +0 real part.
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
