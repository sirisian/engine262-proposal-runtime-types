import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-which-operations-each-family-defines (a complex defines `exponentiate`).
 *
 * AN INTEGER EXPONENT IS REPEATED MULTIPLICATION, not a trip through polar form.
 *
 * Unspecified: the specification gives a complex `exponentiate` but does not say how
 * exact it is. These tests pin the engine's choice. Squaring `i` is exact in the
 * algebraic form, (a+bi)^2 = (a^2-b^2) + 2abi, so `(0 + 1i) ** 2` is `-1 + 0i` with no
 * rounding caveat; through `exp(y*log x)` it would be `-1 + 1.2246467991473532e-16i`,
 * and a purely real `(2 + 0i) ** 3` would be `7.999999999999998` rather than `8`.
 *
 * Multiplication is exact, so the two spellings of a square must agree:
 * `(1+1i) * (1+1i)` and `(1+1i) ** 2` are one value, and the test pins the two
 * together rather than pinning a literal.
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
  // Euler's identity is transcendental and exact only within rounding; a non-integer
  // exponent is unaffected by the integer rule.
  expect(evaluated('String(Math.exp(complex(0, Math.PI)));')).toBe('-1+1.2246467991473532e-16i');
});
