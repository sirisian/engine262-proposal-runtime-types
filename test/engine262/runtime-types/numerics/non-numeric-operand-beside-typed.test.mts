import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * A String, Boolean or nullish operand beside a typed number.
 *
 * ToNumeric makes a Number of each (#sec-tonumeric-revised), and every step after is the Number's:
 * the dispatch step that refuses two operands not of the same numeric type applies to every numeric
 * type, and an exponent or a shift distance is a count, which a Number holding an integer may give.
 * A String was computed as two Numbers instead: `z * "2"` for a `uint32` `z` was the Number 6,
 * `uint8(255) << "2"` was the Number 1020, and a vector's lanes became Strings under `+`. Now a
 * String is read as the Number it becomes, and `+` still concatenates. The refusal of a Boolean
 * named the wrong type: `z * (c && 2)` with `c` *false* said "a value of the number type".
 */

const Z = 'function f(z: uint32, s: any) { return ';

test('a String operand beside a typed number is refused as its Number is, except by +', () => {
  for (const source of [`${Z}z * s; } f(3, "2");`, `${Z}z - s; } f(3, "");`, `${Z}s * z; } f(3, "2");`]) {
    expectThrown(source, 'a value of the "string" type and a "uint.<32>" are different numeric types and do not mix');
  }
  // Written beside a typed number, it is refused before running (Question AQ).
  expectStaticTypeError('function f(z: uint32) { return z * "2"; } f(3);');
  expect(evaluated(`${Z}z + s; } f(3, "x");`)).toBe('3x');
  expect(evaluated('function f(z: uint32) { return z * 2; } String(f(3));')).toBe('6');
});

test('a String count is a count, as a Number is', () => {
  const C = 'function f(v, n) { return v ';
  expect(evaluated(`${C}<< n; } String(f(uint8(255), "2")) + " " + String(f(uint8(255), 2));`)).toBe('252 252');
  expect(evaluated(`${C}<< n; } String(Reflect.typeOf(f(uint8(255), "2")));`)).toBe('uint.<8>');
  expect(evaluated(`${C}** n; } String(f(uint64(9007199254740993n), "1"));`)).toBe('9007199254740993');
  // A count that is no integer is refused as the Number is, and so is a String on the left.
  expectThrown(`${C}** n; } f(uint8(3), "0.5");`, 'a value of the "string" type');
  expectThrown(`${C}** n; } f(uint8(3), 0.5);`, 'a value of the "number" type');
  expectThrown(`${C}<< n; } f("2", uint8(3));`, 'a value of the "string" type');
});

test('a vector reads a String operand as its Number at each lane, and + concatenates', () => {
  expectThrown('function f(v, n) { return v * n; } f(float32x4(1, 2, 3, 4), "2");', 'a value of the "string" type and a "float32"');
  expectThrown('function f(v, n) { return v * n; } f(float32x4(1, 2, 3, 4), 2);', 'a value of the "number" type and a "float32"');
  expect(evaluated('String(float32x4(1, 2, 3, 4) + "x") + " " + String("x" + float32x4(1, 2, 3, 4));')).toBe('(1, 2, 3, 4)x x(1, 2, 3, 4)');
  expect(evaluated('const v = float32x4(1, 2, 3, 4); const s: string = v + "x"; s;')).toBe('(1, 2, 3, 4)x');
});

test('the refusal names the operand\'s own type', () => {
  expectThrown('function f(z: uint32, c: boolean) { return z * (c && 2); } f(3, false);', 'a value of the "boolean" type');
  expectThrown(`${Z}z * s; } f(3, null);`, 'a value of the "null" type');
  expectThrown(`${Z}z * s; } f(3, 2);`, 'a value of the "number" type');
});
