import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-operator-results, #sec-vector-lanes: a scalar of a vector's lane type
// broadcasts through the lane cast, and a literal adopts the lane type. A
// scalar of any other numeric type is a second numeric type, which an operator
// does not combine.

const V = 'const v: float32x4 = new.(0, 1, 2, 3); ';

test('a lane-typed scalar broadcasts on either side', () => {
  expect(evaluated(`${V}const s: float32 = 5; String(v * s);`)).toBe('(0, 5, 10, 15)');
  expect(evaluated(`${V}const s: float32 = 5; String(s * v);`)).toBe('(0, 5, 10, 15)');
  expect(evaluated('let v: float32x4 = new.(0, 1, 2, 3); const s: float32 = 5; v *= s; String(v);')).toBe('(0, 5, 10, 15)');
});

test('a literal adopts the lane type', () => {
  expect(evaluated(`${V}String(v * 2);`)).toBe('(0, 2, 4, 6)');
  expect(evaluated('const v: float32x4 = new.(1, 2, 4, 8); String(8 / v);')).toBe('(8, 4, 2, 1)');
  expect(evaluated('let v: float32x4 = new.(0, 1, 2, 3); v *= 2; String(v);')).toBe('(0, 2, 4, 6)');
});

test('a scalar of another numeric type is a type error', () => {
  expectStaticTypeError('function f(a: float32x4, n: number) { return a * n; }');
  expectStaticTypeError('function f(a: float32x4, d: float64) { return d * a; }');
  expectStaticTypeError('function f(v: float32x4, n: number) { v *= n; }');
});
