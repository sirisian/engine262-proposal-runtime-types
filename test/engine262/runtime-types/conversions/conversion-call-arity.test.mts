import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Question AT: a call on a type takes the values the type's conversion takes.
 * A call on a type and `:=` are one operation (#sec-explicit-conversion), and
 * `:=` has one operand, so `uint8(a, b)` dropped `b` in silence, where a
 * vector's lane count, an array type's construction and a typed class's call
 * were already counted. When run, a conversion ignores what it does not take,
 * as `Number(1, 2)` does, so `values.map(uint8)` still converts each element.
 */

test('a numeric conversion takes one value, and more are refused before running', () => {
  for (const call of ['uint8(1, 2)', 'float32(1.5, 2)', 'int64(1, 2)', 'decimal64(1, 2)', 'uint8(1, "x")']) {
    expectStaticTypeError(`${call};`);
  }
  expectStaticTypeError('type U = uint8; U(1, 2);');
  expectStaticTypeError('enum E : uint8 { A = 1 } E(1, 2);');
  expect(evaluated('String(uint8(300));')).toBe('44');
});

test('a rational and a complex take one value or two', () => {
  expect(evaluated('String(rational64(1, 3)) + " " + String(rational64(2));')).toBe('1/3 2');
  expect(evaluated('String(complex64(1, 2));')).toBe('1+2i');
  expectStaticTypeError('rational64(1, 3, 5);');
});

test('when run, a conversion ignores the values it does not take', () => {
  expect(evaluated('String([1, 300].map(uint8));')).toBe('1,44');
  expect(evaluated('enum E : uint8 { A = 1, B = 2 } String([1, 2].map(E));')).toBe('1,2');
  expect(evaluated('const T = [uint8][0]; String(T(1, 2));')).toBe('1');
  expect(evaluated('String(uint8(...[1, 2]));')).toBe('1');
});
