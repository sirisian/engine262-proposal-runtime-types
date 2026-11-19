import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Question AO, AO1: a constant beside a decimal that uses an operator the decimal does not have.
 *
 * A constant at a decimal type is computed in the type's own arithmetic ("No part of the expression
 * is computed as a Number and converted"), and a decimal has neither bitwise operators nor a power
 * with a fractional exponent. A bitwise or shift constant whose operands are integers is the
 * integer JavaScript computes for it, and a decimal holds that integer exactly, so it is taken:
 * `d * (6 | 1)` is `d * 7`, where it was a TypeError when run. A power with a fractional exponent
 * has no exact value, and the double's digits would enter the decimal silently (`const e:
 * decimal128 = 2 ** 0.5` held 1.414213562373095145474621858738828), so it is refused in both
 * positions, and the program converts a Number explicitly.
 */

const D = 'const d: decimal64 = 2;';
const early = (rule: string) => ({ bodyEntered: false, diagnostic: { rule } });

test('a bitwise or shift constant with integer operands is its integer at a decimal', () => {
  expect(evaluated(`${D} String(d * (6 | 1)) + " " + String(d * (1 << 3)) + " " + String(d * ~1);`)).toBe('14 16 -4');
  expect(evaluated('const e: decimal64 = 6 | 1; const f: decimal64 = ~1; const g: decimal128 = 1 << 3; String(e) + " " + String(f) + " " + String(g);')).toBe('7 -2 8');
  expect(evaluated(`${D} const K = 6; String(d * (K | 1));`)).toBe('14');
  // A comparison reads the constant the same way.
  expect(evaluated('const d: decimal64 = 7; String(d === (6 | 1)) + String(d < (1 << 3));')).toBe('truetrue');
  // The other constants are computed as before.
  expect(evaluated(`${D} String(d * (7 / 2)) + " " + String(d * 2 ** 3);`)).toBe('7.0 16');
});

test('a power with a fractional exponent is refused at a decimal, in both positions', () => {
  expect(observeScript(`${D} d * 2 ** 0.5;`)).toMatchObject(early('rt-numeric-operator'));
  expect(observeScript('const e: decimal64 = 2 ** 0.5;')).toMatchObject(early('rt-numeric-operator'));
  expect(observeScript('const e: decimal128 = 2 ** 0.5;')).toMatchObject(early('rt-numeric-operator'));
  // The explicit conversion of a Number is how a program asks for it.
  expect(evaluated(`${D} String(d * ((2 ** 0.5) := decimal64)) + " " + String(d * decimal64(2 ** 0.5));`)).toBe('2.828427124746190 2.828427124746190');
});
