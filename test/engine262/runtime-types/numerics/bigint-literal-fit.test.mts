import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectThrown } from '../harness.mts';

/**
 * Spec: #sec-requiretype, #table-numeric-conversions. `bigint` is an ordinary
 * numeric type at a boundary (bigint-boundary.test.mts), and a LITERAL is
 * judged statically by the rule the boundary would apply to its value, as a
 * Number literal is: `5` fits `uint8` and `300` does not. A BigInt literal
 * was refused against every sized target instead - `const a: int64 = 1n` -
 * although the dynamic boundary accepted the same value and a Number literal
 * crossed into `bigint` statically.
 */

test('a BigInt literal fits an integer type by its value', () => {
  expect(evaluated('const a: int64 = 1n; String(a);')).toBe('1');
  expect(evaluated('const a: int8 = -128n; String(a);')).toBe('-128');
  expectEarlyError('const a: int8 = 300n;', 'StaticTypeError');
  expectThrown('const a: int8 = 300n;', '"300n" is not assignable to "int.<8>"');
  // An explicit conversion is not a boundary: it wraps, for every source.
  expect(evaluated('String(uint8(300n));')).toBe('44');
});

test('a float or number takes a BigInt literal unless it overflows', () => {
  expect(evaluated('const f: float64 = 5n; String(f);')).toBe('5');
  expect(evaluated('const g: number = 5n; String(g);')).toBe('5');
  expectEarlyError('const f: float32 = 10n ** 39n;', 'StaticTypeError');
});

test('a BigInt literal type displays as written', () => {
  expect(evaluated('type L = 5n; String(L);')).toBe('5n');
});

test('what the literal rule does not reach is unchanged', () => {
  // A typed VALUE needs static assignability, for every numeric type alike.
  expectEarlyError('const b: bigint = 5n; const i: int64 = b;', 'StaticTypeError');
  // Operators never convert between numeric types.
  expectThrown('(1 := int64) + 1n;', 'Cannot mix BigInt and other types');
});
