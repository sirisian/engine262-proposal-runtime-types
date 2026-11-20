import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Question BQ: a rational has no remainder (#table-family-operations), and a
 * constant at a rational type is computed by the type's own operators, so a
 * `%` in it is the type error `q % 4` is. `const q: rational64 = 7 % 4` was 3,
 * the Number's remainder converted, and `q * (7 % 4)` a TypeError when it ran.
 * The operands of a bitwise operator are Numbers (Question BO), so a `%` or a
 * fractional power among them is the Number's.
 */

test('a remainder in a constant at a rational is refused, as of a rational', () => {
  expectStaticTypeError('const q: rational64 = 7 % 4;');
  expectStaticTypeError('const q: rational64 = 1; q * (7 % 4);');
  expectStaticTypeError('const K = 7.5 % 2; const q: rational64 = 1; q * K;');
  expect(evaluated('const q: rational64 = (7 % 4) | 0; const d: decimal64 = (2 ** 0.5) | 0; String(q) + " " + String(d);')).toBe('3 1');
});

test('where only the run time knows the rational, the remainder is the Number\'s, read exactly', () => {
  expect(evaluated('function f(a) { return String(a * (7 % 4)) + " " + String(a * (7.5 % 2)) + " " + String(a * (-7 % 4)); } f(rational64(1));')).toBe('3 3/2 -3');
  expect(evaluated('function f(a) { return a + (0.3 % 0.1); } String(f(decimal64(0)));')).toBe('0');
});
