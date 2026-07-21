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
 *  - SIMD/vector types (`vector.<T, N>`, `float32x4`, `uint32x4`) are not
 *    registered; the SIMD lane types, broadcast constructors, and SIMD operators
 *    are the SIMD extension.
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

test('SIMD: vector and named SIMD lane types are not registered (documents the gap)', () => {
  // Target (README/spec): `vector.<T, N>` is a core value type and the named lane
  // types (float32x4, uint32x4) are SIMD specializations with broadcast and
  // operators. Today none are registered.
  expectThrown('let a: float32x4;');
  expectThrown('let a: uint32x4;');
});
