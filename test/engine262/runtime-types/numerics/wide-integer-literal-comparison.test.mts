import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * A literal compared with an integer wider than a Number (#sec-literalvalueintype,
 * #sec-arithmetic-never-promotes).
 *
 * A literal beside a typed operand takes that operand's type at "the mathematical value denoted by
 * the literal ... before any rounding". In arithmetic it did: `z - 9007199254740992` for a
 * `uint64` was exact. In a comparison the literal had already been rounded to a double, so for a
 * `z` holding 9007199254740993, `z === 9007199254740993` compared it with ...992 and was *false*,
 * `z <= 9007199254740993` was *false*, and the `case 9007199254740993:` beside it was never
 * selected.
 */

const Z = 'const z: uint64 = 9007199254740993; ';

test('a literal is read at the integer its text denotes', () => {
  expect(evaluated(`${Z}String(z === 9007199254740993) + String(z === 9007199254740992) + String(9007199254740993 === z);`)).toBe('truefalsetrue');
  expect(evaluated(`${Z}String(z !== 9007199254740993) + String(z == 9007199254740993) + String(z != 9007199254740993);`)).toBe('falsetruefalse');
  expect(evaluated(`${Z}String(z <= 9007199254740993) + String(z >= 9007199254740993) + String(z < 9007199254740993) + String(z > 9007199254740993);`))
    .toBe('truetruefalsefalse');
  expect(evaluated(`${Z}let r = "miss"; switch (z) { case 9007199254740993: r = "hit"; break; default: } r;`)).toBe('hit');
  expect(evaluated(`${Z}String(Object.is(z, 9007199254740993)) + String(Object.is(z, 9007199254740992));`)).toBe('truefalse');
  expect(evaluated('const z: int64 = -9007199254740993; String(z === -9007199254740993) + String(z === -9007199254740992);')).toBe('truefalse');
  expect(evaluated('const z: uint64 = 0x20000000000001; String(z === 0x20000000000001) + String(z === 0x20000000000000);')).toBe('truefalse');
  // Where the operand's type is known only when the comparison runs.
  expect(evaluated('function f(z) { return z === 9007199254740993; } String(f(uint64(9007199254740993n)));')).toBe('true');
});

test('a named constant and a constant expression past the integers a Number holds', () => {
  expect(evaluated(`${Z}const K = 9007199254740993; String(z === K) + String(z <= K) + String(z >= K) + String(z < K);`)).toBe('truetruetruefalse');
  expect(evaluated(`${Z}String(z === 9007199254740992 + 1) + String(z === 2 ** 53 + 1) + String(z <= 2 ** 53 + 1) + String(z === 2 ** 53);`)).toBe('truetruetruefalse');
  expect(evaluated('const K = 9007199254740993; function f(z: uint64) { return z === K; } String(f(9007199254740993)) + String(f(9007199254740992));'))
    .toBe('truefalse');
});

test('what a comparison answered before, it still answers', () => {
  // A value the type cannot hold is equal to nothing of it.
  expect(evaluated('const z: uint64 = 5; String(z === 36893488147419103232) + String(z === -1) + String(z === 5.5);')).toBe('falsefalsefalse');
  expect(evaluated('const z: uint64 = 5; const K = 2 ** 70; String(z === K);')).toBe('false');
  // An integer written with a fraction or an exponent is that integer.
  expect(evaluated('const z: uint64 = 5; String(z === 5.0) + String(z === 5e0) + String(z === 50e-1);')).toBe('truetruetrue');
  expect(evaluated('const z: uint64 = 10000000000000000000; String(z === 1e19) + String(z === 10000000000000000000);')).toBe('truetrue');
  // A narrower integer, and a small constant beside a wide one, are read as they were.
  expect(evaluated('const z: uint32 = 7; String(z === 7) + String(z === 8) + String(z < 8);')).toBe('truefalsetrue');
  expect(evaluated('const z: uint64 = 5; const K = 5; String(z === K) + String(z < K);')).toBe('truefalse');
  expect(evaluated(`${Z}String(z - 9007199254740992) + "," + String(z + 1);`)).toBe('1,9007199254740994');
});
