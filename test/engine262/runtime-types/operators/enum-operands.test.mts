import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-enums: an enum is subsumed into its underlying type, which is "why an
// enum can be used for arithmetic, indexing, and comparison without a cast".
// An operator reads an enum operand at its underlying type.

const E = 'enum E: uint8 { A = 1 } ';

test('an enum-typed operand is judged at its underlying type', () => {
  expectStaticTypeError(`${E}function f(e: E) { return e + 300; }`);
  expectStaticTypeError(`${E}function f(e: E, b: uint16) { return e + b; }`);
  expectStaticTypeError(`${E}function f(e: E) { return e < 300; }`);
  expectStaticTypeError("type UserId = uint32.<{ brand: 'UserId' }>; enum F: uint32 { A = 1 } function f(a: UserId, b: F) { return a + b; }");
});

test('arithmetic at the underlying type works, and its result is that type', () => {
  expect(evaluated(`${E}function f(e: E, b: uint8) { return e + b; } String(f(E.A, 2));`)).toBe('3');
  expect(evaluated(`${E}function f(e: E): uint8 { return e + 1; } String(f(E.A));`)).toBe('2');
});
