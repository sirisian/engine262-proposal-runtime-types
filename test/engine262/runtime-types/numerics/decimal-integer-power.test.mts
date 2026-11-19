import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown, expectThrownKind } from '../harness.mts';

/**
 * Question AS, AS1: a decimal power takes an integer exponent and is the exact power rounded once.
 *
 * The family table gives a decimal `exponentiate`, decimal.md lists `**`, and the run time had
 * none: `d ** 2` was "this operator is not defined for a decimal". A constant at a decimal or a
 * rational type with a negative exponent was computed as a Number, so `3 ** -1` at a `decimal128`
 * held the double's third, and beside a decimal operand `d * 2 ** -1` was a TypeError.
 */

const D64 = 'const d: decimal64 = ';

test('an integer exponent gives the exact power, rounded once', () => {
  expect(evaluated(`${D64}2; String(d ** 2) + " " + String(d ** 10) + " " + String(d ** 0);`)).toBe('4 1024 1');
  // The preferred exponent is that of repeated multiplication.
  expect(evaluated(`${D64}1.50; String(d ** 2) + " " + String(d * d);`)).toBe('2.2500 2.2500');
  expect(evaluated(`${D64}-2; String(d ** 3);`)).toBe('-8');
  expect(evaluated(`${D64}1.0; String(d ** 50);`)).toBe('1.000000000000000');
  expect(evaluated(`${D64}2; String(Reflect.typeOf(d ** 2));`)).toBe('decimal64');
  // A power near 1 whose exact value is too long to compute is bracketed and rounded once.
  expect(evaluated(`${D64}1.000000000000001; String(d ** 100000000);`)).toBe('1.000000100000005');
});

test('a negative exponent gives the reciprocal, rounded once', () => {
  expect(evaluated(`${D64}2; String(d ** -1) + " " + String(d ** -3);`)).toBe('0.5 0.125');
  expect(evaluated('const d: decimal128 = 3; String(d ** -1);')).toBe('0.3333333333333333333333333333333333');
  expect(evaluated(`${D64}-2; String(d ** -3);`)).toBe('-0.125');
  expect(evaluated(`${D64}0.01; const one: decimal64 = 1; String(d ** -1) + " " + String(one / d);`)).toBe('100 100');
  expect(evaluated(`${D64}1.000000000000001; String(d ** -100000000);`)).toBe('0.9999999000000050');
  expectThrown(`${D64}0; d ** -1;`, 'division of a decimal by zero');
});

test('the exponent may be of any integer type, a BigInt, or a Number or decimal holding an integer', () => {
  expect(evaluated('function f(d: decimal64, k: int32) { return d ** k; } String(f(2, 10)) + " " + String(f(2, -2));')).toBe('1024 0.25');
  expect(evaluated('function f(d: decimal64, k: bigint) { return d ** k; } String(f(2, 3n));')).toBe('8');
  expect(evaluated('function f(d: decimal64, k: number) { return d ** k; } String(f(2, 3));')).toBe('8');
  expect(evaluated('function f(d: decimal64, k: decimal64) { return d ** k; } String(f(2, 3));')).toBe('8');
  expect(evaluated('let d: decimal64 = 3; d **= 2; String(d);')).toBe('9');
  // One that is no integer has no exact power to round: a value of an admitted
  // kind out of the power's domain, a RangeError (Question AY), where an
  // exponent of a type not admitted is a type error.
  for (const call of ['function f(d: decimal64, k: number) { return d ** k; } f(2, 0.5);',
    'function f(d: decimal64, k: decimal64) { return d ** k; } f(2, 0.5);',
    'function f(d: decimal64, k: number) { return d ** k; } f(2, NaN);']) {
    expectThrownKind(call, 'RangeError');
    expectThrown(call, 'is not an integer');
  }
  expectStaticTypeError('function f(d: decimal64, k: float32) { return d ** k; }');
});

test('a result outside the range is a RangeError', () => {
  expectThrown('const d: decimal32 = 10; d ** 200;', 'a decimal result is outside the range of "decimal32"');
  expectThrown('const d: decimal32 = 0.1; d ** 200;', 'a decimal result is outside the range of "decimal32"');
});

test('a constant with a negative exponent is computed in the type', () => {
  expect(evaluated('const e: decimal128 = 3 ** -1; String(e);')).toBe('0.3333333333333333333333333333333333');
  expect(evaluated('const e: decimal64 = 10 ** -2; String(e);')).toBe('0.01');
  expect(evaluated(`${D64}3; String(d * 2 ** -1) + " " + String(d * 2 ** 3);`)).toBe('1.5 24');
  expect(evaluated('const q: rational64 = 3 ** -1; String(q);')).toBe('1/3');
  expect(evaluated('const q: rational64 = (2 / 3) ** -2; String(q);')).toBe('9/4');
  expect(evaluated('const q: rational64 = 3; String(q * 2 ** -1);')).toBe('3/2');
  // A fractional power is refused, and a conversion's operand is a Number's power.
  expectStaticTypeError('const e: decimal64 = 2 ** 0.5;');
  expect(evaluated(`${D64}2; String(d * ((2 ** 0.5) := decimal64));`)).toBe('2.828427124746190');
});

test('a fractional power in a constant is refused at a rational, as at a decimal', () => {
  // A rational's power takes an integer exponent (#table-family-operations), so
  // the double's digits do not enter it unnoticed: `2 ** 0.5` at a `rational64`
  // was 6369051672525773/4503599627370496.
  for (const source of ['const q: rational64 = 2 ** 0.5;', 'const q: rational64 = 4 ** 0.5;',
    'function g(q: rational64) { return q * 2 ** 0.5; }']) {
    expectStaticTypeError(source);
  }
  // Written as a conversion of the Number, it is the program's choice.
  expect(evaluated('const q = (2 ** 0.5) := rational64; String(q);')).toBe('6369051672525773/4503599627370496');
  expect(evaluated('const q: rational64 = 2 ** -1; String(q);')).toBe('1/2');
});

test('an exponent known to hold no integer is refused before running', () => {
  // Question AU: at a decimal or a rational base as at an integer one, a
  // literal, a constant or a constant expression that is no integer.
  for (const source of ['function f(d: decimal64) { return d ** 2.5; }', 'function f(d: decimal64) { return d ** (1 / 2); }',
    'const K = 2.5; function f(d: decimal64) { return d ** K; }', 'function f(d: decimal64) { d **= 2.5; return d; }',
    'function f(q: rational64) { return q ** 0.5; }', 'function f(n: uint8) { return n ** 0.5; }', 'function f(n: uint8) { return n << 0.5; }']) {
    expectStaticTypeError(source);
  }
  // An integer written with a fraction or an exponent is an integer.
  expect(evaluated('function f(d: decimal64) { return String(d ** 2.0) + " " + String(d ** 1e1); } f(decimal64(2));')).toBe('4 1024');
  // A binary float has a real power.
  expect(evaluated('function f(h: float128) { return String(h ** 0.5); } f(float128(4));')).toBe('2');
});
