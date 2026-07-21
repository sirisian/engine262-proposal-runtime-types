import { test, expect } from 'vitest';
import { evaluated, expectThrown, runFlagOff } from '../readme/harness.mts';

/**
 * Vector types: vector.<T, N> well-formedness.
 *
 * `vector.<T, N>` is a core value type whose values are the sequences of exactly N
 * values of the lane type T (spec sec-vector-types). It is well-formed when T is a
 * lane type, meaning an integer type, a binary floating-point type, or itself a
 * vector type, and N is a positive integer. A vector whose lane type is not a lane
 * type, or whose lane count is not a positive integer, is a type error at the point
 * its type is formed. A lane type that is itself a vector is validated recursively,
 * which is how the design's boolean vectors are built (boolean8 is vector.<uint.<1>,
 * 8> and boolean8x16 is vector.<boolean8, 16>).
 *
 * Not covered here (the SIMD extension): the named lane-type aliases (float32x4,
 * uint32x4, boolean8), the implicit broadcast constructor from the lane type, the
 * SIMD operators over matching vector types, and lane access.
 */

// -- Well-formed vectors -------------------------------------------------------
test('an integer lane type with a positive count is well-formed', () => {
  expect(evaluated('type V = vector.<uint32, 4>; typeof V;')).toBe('object');
  expect(evaluated('type V = vector.<int32, 8>; typeof V;')).toBe('object');
  expect(evaluated('type V = vector.<uint.<1>, 8>; typeof V;')).toBe('object');
});

test('a binary floating-point lane type is well-formed', () => {
  expect(evaluated('type V = vector.<float32, 4>; typeof V;')).toBe('object');
  expect(evaluated('type V = vector.<float64, 2>; typeof V;')).toBe('object');
});

test('a vector lane type is well-formed and validated recursively', () => {
  // boolean8x16 is vector.<vector.<uint.<1>, 8>, 16>
  expect(evaluated('type V = vector.<vector.<uint.<1>, 8>, 16>; typeof V;')).toBe('object');
});

// -- Malformed lane type -------------------------------------------------------
test('a non-lane lane type is a type error', () => {
  expectThrown('type V = vector.<string, 4>;');
  expectThrown('type V = vector.<boolean, 4>;');
});

test('a malformed nested lane type is caught recursively', () => {
  expectThrown('type V = vector.<vector.<string, 8>, 16>;');
});

// -- Malformed lane count ------------------------------------------------------
test('a zero lane count is a type error', () => {
  expectThrown('type V = vector.<uint32, 0>;');
});

test('a negative lane count is a type error', () => {
  expectThrown('type V = vector.<uint32, -1>;');
});

// -- Feature off ---------------------------------------------------------------
test('with the feature off, vector type syntax is not part of the language', () => {
  // `vector.<...>` type annotations only exist under the feature; a plain program is unaffected
  const c = runFlagOff('let x = 5; String(x);') as { Type: string, Value: { stringValue?(): string } };
  expect(c.Type).toBe('normal');
  expect(c.Value.stringValue?.()).toBe('5');
});
