import { test, expect } from 'vitest';
import { evaluated, expectThrown, expectErrorFlagOff } from './harness.mts';

/**
 * README feature coverage — SIMD and multidimensional/jagged arrays.
 * Sections: Implicit SIMD Constructors, SIMD Operators, Multidimensional and
 * Jagged Array Support Via User-defined Index Operators.
 *
 *  - The index-accessor operator `operator[](...)` declares and, for the read
 *    direction, dispatches: a numeric index access `m[i]` on an instance whose
 *    class declares `operator[]` calls that operator with the index. Implemented and
 *    verified here. The write direction (`set operator[]`), the multi-argument form
 *    `m[x, y]` (which needs the comma-index grammar of the ranges extension), and
 *    overload resolution among several index operators are deferred.
 *  - `vector.<T, N>` is validated as a core value type: T must be an integer,
 *    binary floating-point, or vector type and N a positive integer, else it is a
 *    type error. The named SIMD lane types (`float32x4`, `uint32x4`), their implicit
 *    broadcast constructors, the SIMD operators, and lane access are the SIMD
 *    extension and are not registered.
 */

// ── Index-accessor operator declaration ───────────────────────────────────────
// A class may declare its own index operators, and more than one with unique
// signatures.
test('Index operators: a single-parameter index operator declaration parses', () => {
  expect(evaluated('class Arr { operator[](i: uint32) { return i; } } typeof Arr;')).toBe('function');
});

test('Index operators: multi-parameter index operators declare multidimensional access', () => {
  expect(evaluated('class Matrix { operator[](x: uint32, y: uint32) { return x; } } typeof Matrix;')).toBe('function');
  // a three-dimensional index operator
  expect(evaluated('class Cube { operator[](x: uint32, y: uint32, z: uint32) { return x; } } typeof Cube;')).toBe('function');
});

test('Index operators: an index operator may be declared without a body (signature form)', () => {
  expect(evaluated('class Arr { operator[](i: uint32); } typeof Arr;')).toBe('function');
});

test('Index operators: the declaration syntax requires the runtime-types feature', () => {
  // with the feature off, operator[] is not class syntax
  expectErrorFlagOff('class Arr { operator[](i) { return i; } } typeof Arr;');
});

// ── Documented gaps ───────────────────────────────────────────────────────────
// ── Index operator dispatch (read direction) ──────────────────────────────────
// A numeric index access `m[i]` on an instance whose class declares `operator[]`
// dispatches to that operator, called with the index (README "Multidimensional and
// Jagged Array Support Via User-defined Index Operators").
test('Index operators: m[i] on a class with an index operator dispatches to it', () => {
  expect(evaluated('class M { operator[](i: uint32) { return (99 := uint32); } } let m = new M(); String(m[(0 := uint32)]);')).toBe('99');
  // the index is passed to the operator
  expect(evaluated('class M { operator[](i) { return i * 10; } } let m = new M(); String(m[5]);')).toBe('50');
  // the operator body sees `this`
  expect(evaluated('class M { constructor() { this.d = [10, 20, 30]; } operator[](i) { return this.d[i]; } } let m = new M(); String(m[1]);')).toBe('20');
});

test('Index operators: a non-numeric key falls through to ordinary property access', () => {
  // a string key reaches a method, so an index-defining class keeps its methods
  expect(evaluated('class M { operator[](i) { return 1; } foo() { return 7; } } let m = new M(); String(m["foo"]());')).toBe('7');
});

// ── Vector types: vector.<T, N> ───────────────────────────────────────────────
// `vector.<T, N>` is a core value type of exactly N lanes of a lane type T. It is
// well-formed when T is an integer, binary floating-point, or vector type and N is
// a positive integer; a malformed vector is a type error (spec sec-vector-types).
test('Vectors: vector.<T, N> is a well-formed core type for a lane type and positive count', () => {
  expect(evaluated('type V = vector.<uint32, 4>; typeof V;')).toBe('object');
  expect(evaluated('type V = vector.<float32, 4>; typeof V;')).toBe('object');
  // a lane type may itself be a vector: boolean8x16 is vector.<vector.<uint.<1>, 8>, 16>
  expect(evaluated('type V = vector.<vector.<uint.<1>, 8>, 16>; typeof V;')).toBe('object');
});

test('Vectors: a malformed vector is a type error', () => {
  // a non-lane lane type
  expectThrown('type V = vector.<string, 4>; typeof V;');
  // a non-positive lane count
  expectThrown('type V = vector.<uint32, 0>; typeof V;');
  expectThrown('type V = vector.<uint32, -1>; typeof V;');
});

test('SIMD: the named lane types are registered and are the long form', () => {
  // The shorthand names are aliases, not new types, so each is the same interned
  // type as the vector it abbreviates.
  expect(evaluated('type A = float32x4; type B = vector.<float32, 4>; (A === B) ? "same" : "diff";')).toBe('same');
  expect(evaluated('type A = uint32x4; String(A.byteLength);')).toBe('16');
  // Still to come: the broadcast cast from the lane type, the operators over
  // matching vector types, and lane access.
  expectThrown('let a: float32x4 = float32x4(1, 2, 3, 4);');
});
