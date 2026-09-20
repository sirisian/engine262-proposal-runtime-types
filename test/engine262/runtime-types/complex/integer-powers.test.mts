import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * AN INTEGER EXPONENT IS REPEATED MULTIPLICATION, not a trip through polar form.
 *
 * `complex.md` writes `(0 + 1i) ** 2; // -1 + 0i` with no rounding caveat -
 * unlike its Euler line, which says "within rounding" - and squaring `i` is
 * exact in the algebraic form: (a+bi)² is (a²-b²) + 2abi.
 *
 * Through `exp(y·log x)` it was not. Before this, `i ** 2` gave
 * `-1 + 1.2246467991473532e-16i`, `i ** 3` gave `-1.8369701987210297e-16 - 1i`,
 * and `(2 + 0i) ** 3` - a purely real value at an integer power - gave
 * `7.999999999999998`.
 *
 * Multiplication was exact throughout, so the two spellings of a square
 * disagreed: `(1+1i) * (1+1i)` was `2i` while `(1+1i) ** 2` was
 * `1.2246467991473532e-16 + 2i`. That disagreement is the sharpest form of the
 * defect, and the test below pins the two together rather than pinning a
 * literal.
 */
const RI = (e: string) => `const z = ${e}; String(z.real) + ' , ' + String(z.imaginary);`;

test('the powers of i are exact', () => {
  expect(evaluated(RI('(0 + 1i) ** 2'))).toBe('-1 , 0');
  expect(evaluated(RI('(0 + 1i) ** 3'))).toBe('0 , -1');
  expect(evaluated(RI('(0 + 1i) ** 4'))).toBe('1 , 0');
});

test('a power agrees with the multiplication that spells it', () => {
  expect(evaluated(`String((1 + 1i) ** 2) + '|' + String((1 + 1i) * (1 + 1i));`)).toBe('2i|2i');
  expect(evaluated(RI('(3 + 4i) ** 2'))).toBe('-7 , 24');
});

test('a purely real complex at an integer power is exact', () => {
  expect(evaluated(RI('(2 + 0i) ** 3'))).toBe('8 , 0');
});

test('zero, one and a negative exponent', () => {
  expect(evaluated(RI('(0 + 1i) ** 0'))).toBe('1 , 0');
  expect(evaluated(RI('(0 + 1i) ** -1'))).toBe('0 , -1');
  expect(evaluated(RI('(2 + 0i) ** -2'))).toBe('0.25 , 0');
  // 0 to a positive power stays 0, per Annex G.
  expect(evaluated(RI('(0 + 0i) ** 2'))).toBe('0 , 0');
});

test('a non-integer or complex exponent still goes through polar form', () => {
  expect(evaluated(RI('(1 + 0i) ** 0.5'))).toBe('1 , 0');
  // complex.md's Euler line, which says "within rounding" and is unaffected.
  expect(evaluated('String(Math.exp(complex(0, Math.PI)));')).toBe('-1+1.2246467991473532e-16i');
});
