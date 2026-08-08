import { test, expect } from 'vitest';
import { evaluated, expectThrown, runFlagOff } from '../harness.mts';

/**
 * Spec: #sec-vector-types (Vector Types) - `vector.<T, N>` well-formedness.
 *
 * `vector.<T, N>` is a core value type whose values are the sequences of exactly N
 * values of the lane type T. It is well-formed when T is a
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

// -- The named lane types --------------------------------------------------------

test('simd: the shorthand names abbreviate the register-width vectors', () => {
  // memorylayout.md's own example: a SIMD vector aligns to its whole width rather
  // than the capped natural rule, since the register is addressed that way
  expect(evaluated('type V = float32x4; String(V.byteLength);')).toBe('16');
  expect(evaluated('type V = float32x4; String(V.alignment);')).toBe('16');
  // a shorthand is an alias, not a new type
  expect(evaluated('type A = float32x4; type B = vector.<float32, 4>; (A === B) ? "same" : "diff";')).toBe('same');
  // the 128 bit and 256 bit families
  expect(evaluated('type V = int8x16; String(V.byteLength);')).toBe('16');
  expect(evaluated('type V = uint64x2; String(V.byteLength);')).toBe('16');
  expect(evaluated('type V = float32x8; String(V.byteLength);')).toBe('32');
  expect(evaluated('type V = int64x4; String(V.byteLength);')).toBe('32');
});

test('simd: a bit vector packs its lanes as bits', () => {
  // eight one-bit lanes in a single byte, which is what makes boolean8 a usable
  // bitfield rather than a name for a byte
  expect(evaluated('type V = boolean8; String(V.byteLength);')).toBe('1');
  expect(evaluated('type V = boolean64; String(V.byteLength);')).toBe('8');
  // and a vector of those still fills its register
  expect(evaluated('type V = boolean32x4; String(V.byteLength);')).toBe('16');
  expect(evaluated('type V = boolean8x16; String(V.byteLength);')).toBe('16');
});

test('simd: a name exists only where the lanes fill a register', () => {
  // float32x4 has a name and a three lane float vector does not
  expectThrown('type V = float32x3; V;');
  expectThrown('type V = float32x5; V;');
  expectThrown('type V = uint8x8; V;');
  // the long form still validates its lane type
  expectThrown('type V = vector.<string, 4>; V;');
});

// -- primitive metadata: carrying a metadata parameterization --------------------
