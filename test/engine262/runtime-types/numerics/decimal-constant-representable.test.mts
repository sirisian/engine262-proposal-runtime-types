import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * A decimal holds a literal exactly or not at all (#sec-literalvalueintype):
 * "If _c_ is outside the coefficient range of _t_, return ~unrepresentable~.
 * If _q_ is outside the exponent range of _t_, return ~unrepresentable~." The
 * bare literal was judged so; a signed one, a constant expression, and a
 * literal beside a decimal known only at run time were judged by the adjusted
 * exponent alone and rounded: `const d: decimal32 = -12345679` was -12345680,
 * `12345678 + 1` there 12345680, and `a + 12345679` beside one 12345680.
 *
 * And a named constant whose `/` does not divide has no integer value at a
 * decimal: the value an integer position reads, where `/` truncates, was taken
 * there, so `const K = 7 / 2; const q: decimal64 = K * 2` was 6.
 */

test('a named constant has its own value inside a decimal constant', () => {
  expect(evaluated('const K = 7 / 2; const q: decimal64 = K * 2; const r: decimal64 = K + 0; String(q) + " " + String(r);')).toBe('7.0 3.5');
  expect(evaluated('const K = 1 / 3; const q: decimal64 = K * 3; String(q);')).toBe('0.9999999999999999');
  expect(evaluated('const K = 7 / 2; function g(x: decimal64) { return x === K + 0; } String(g(decimal64.parse("3.5")));')).toBe('true');
  // Beside a decimal known only at run time, as where it is typed.
  expect(evaluated('const K = 7 / 2; function f(a) { return a * K; } String(f(decimal64(2)));')).toBe('7.0');
  expectThrown('const K = 1 / 3; function f(a) { return a * K; } f(decimal64(3));', '"K" is not in the range of "decimal64"');
});

test('a literal the type cannot hold as written is refused however it is written', () => {
  expectThrown('const d: decimal32 = -12345679;', '"-12345679" is not in the range of "decimal32"');
  expectThrown('const d: decimal32 = -1.234567891;', '"-1.234567891" is not in the range of "decimal32"');
  expectThrown('const d: decimal64 = -1e370;', '"-1e370" is not in the range of "decimal64"');
  expectThrown('const e: decimal32 = 12345678 + 1;', '"12345678" is not in the range of "decimal32"');
  // A computed value is the type's in any member of its cohort.
  expect(evaluated('const e: decimal32 = 9999999 + 1; String(e);')).toBe('10000000');
  // A conversion converts its operand, and rounds it.
  expect(evaluated('String((12345678 + 1) := decimal32);')).toBe('12345680');
});

test('where only the run time knows the decimal', () => {
  expectThrown('function f(a) { return a + 12345679; } f(decimal32(1));', '"12345679" is not in the range of "decimal32"');
  expectThrown('function f(a) { return a + 12345678901234567; } f(decimal64(1));', '"12345678901234567" is not in the range of "decimal64"');
  expect(evaluated('function f(a) { return a === 12345679; } String(f(decimal32.parse("1.234568E+7")));')).toBe('false');
  expect(evaluated('function f(a) { return String(a + (9999999 + 1)) + String(a === 9999999 + 1); } f(decimal32(0));')).toBe('10000000false');
});

test('an equality and a case label find such a constant equal to nothing', () => {
  expect(evaluated('function g(x: decimal32) { return x === 12345679; } String(g(decimal32(1)));')).toBe('false');
  expect(evaluated('function g(x: decimal32) { return String(x === 12345678 + 1) + String(x === 9999999 + 1); } g(decimal32.parse("1E+7"));')).toBe('falsetrue');
  expectThrown('function g(x: decimal32) { switch (x) { case 12345679: return 1; } return 0; }', 'the "12345679" test can never succeed');
  expectThrown('function g(x: decimal64) { switch (x) { case 1e400 * 1: return 1; } return 0; }', 'the "1e400 * 1" test can never succeed');
  expectStaticTypeError('function g(x: decimal32) { if (x === 12345679) return 1; return 0; }');
});
