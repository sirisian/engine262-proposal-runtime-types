import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-vector-lanes: a vector type called with its lanes constructs the
// vector, one argument per lane or one broadcast to every lane, and each
// argument is judged at the lane type as an argument is.

test('a lane argument the lane type cannot hold is a type error', () => {
  expectStaticTypeError('function f() { const v: vector.<uint.<8>, 4> = new.(300, 0, 0, 0); }');
  expectStaticTypeError('function f() { return uint8x16(300, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0); }');
  expectStaticTypeError('function f() { return uint8x16(300); }');
  expectStaticTypeError('function f() { const v: vector.<uint.<8>, 4> = new.("s", 0, 0, 0); }');
});

test('valid lanes and a broadcast construct as before', () => {
  expect(evaluated('String(float32x4(1, 2, 3, 4));')).toBe('(1, 2, 3, 4)');
  expect(evaluated('const v: float32x4 = new.(7); String(v);')).toBe('(7, 7, 7, 7)');
});
