import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * The exact folds stopped at an exponent of 4096 and left a larger power to the
 * type's arithmetic. They compute up to 2**16 bits now, which holds every value
 * of every bounded numeric type, so a constant that overflows one is computed
 * exactly and refused. `2 ** 20000` at a `float128` was Infinity, where
 * `2 ** 1024` at a `float64` is refused; beside a rational known only at run
 * time `2 ** 5000` was computed as a Number and refused as "a rational has no
 * Number value"; and a refusal printed all 1,506 digits of 2**5000.
 */

test('a power that overflows a float128 is refused before running', () => {
  expectThrown('const q: float128 = 2 ** 20000;', '"2 ** 20000" is not in the range of "float128"');
  expectStaticTypeError('function f(q: float128) { return q * 2 ** 16384; }');
  expect(evaluated('const q: float128 = 2 ** 16383; String(q > float128(0));')).toBe('true');
});

test('beside a rational known only at run time, the power is the rational\'s', () => {
  const U = (value: string, constant: string) => `function f(x) { return String(x * (${constant})); } f(${value});`;
  expectThrown(U('rational64(1)', '2 ** 5000'), '"2 ** 5000" is not in the range of "rational64"');
  expect(evaluated(U('rational.<bigint>(1)', '2 ** 5000'))).toBe((2n ** 5000n).toString());
  expect(evaluated(U('rational.<bigint>(1)', '(1 / 2) ** 5000'))).toBe(`1/${(2n ** 5000n).toString()}`);
});

test('at a rational and an integer type, the refusal is named as written where its digits run long', () => {
  expectThrown('const q: rational64 = 2 ** 5000;', '"2 ** 5000" is not in the range of "rational64"');
  expectThrown('const q: int64 = 2 ** 5000;', '"2 ** 5000" is not in the range of "int.<64>"');
  // A short value is named by its value, as `200 + 100` at a `uint8` is.
  expectThrown('const k: uint8 = 200 + 100;', '"300" is not in the range of "uint.<8>"');
  expectThrown('const q: rational64 = 2 ** 100;', '"1267650600228229401496703205376" is not in the range of "rational64"');
});

test('a power past the budget still declines, and nothing hangs', () => {
  // 10 ** 100000 has some 330,000 bits: it is left to the type's arithmetic.
  expect(evaluated('const b: bigint = 10n ** 100000n; String(b.toString().length);')).toBe('100001');
});
