import { test, expect } from 'vitest';
import { evaluated, expectThrown, expectErrorFlagOff } from './harness.mts';

/**
 * README feature coverage — SIMD and multidimensional/jagged arrays.
 * Sections: Implicit SIMD Constructors, SIMD Operators, Multidimensional and
 * Jagged Array Support Via User-defined Index Operators.
 *
 *  - The index-accessor operator DECLARATION (`operator[](...)`) parses; it is in
 *    the normative overloadable-operators list. The runtime dispatch of `m[i]` to
 *    a declared index operator, and multidimensional/jagged array semantics, are
 *    documented as a gap (PENDING-CAPABILITIES.md capability M).
 *  - SIMD/vector types (`vector.<T, N>`, `float32x4`, `uint32x4`) are not
 *    registered; the SIMD lane types, broadcast constructors, and SIMD operators
 *    are the SIMD extension (capability N).
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
test('Index operators: m[i] dispatch to a user operator is not yet wired (documents the gap)', () => {
  // Target (README): `m[0]` dispatches to `operator[](i)`. Today the declaration
  // parses but the runtime access does not consult it, so m[0] is undefined.
  expect(evaluated('class M { operator[](i: uint32) { return (99 := uint32); } } let m = new M(); String(m[0]);')).toBe('undefined');
});

test('SIMD: vector and named SIMD lane types are not registered (documents the gap)', () => {
  // Target (README/spec): `vector.<T, N>` is a core value type and the named lane
  // types (float32x4, uint32x4) are SIMD specializations with broadcast and
  // operators. Today none are registered.
  expectThrown('let a: float32x4;');
  expectThrown('let a: uint32x4;');
});
