import { test, expect } from 'vitest';
import { evaluated, ok, bool, expectThrown } from '../readme/harness.mts';

/**
 * Extension coverage — complex.md, decimal.md, rational.md (extended numeric types).
 *
 * `float128` and `decimal32/64/128` are core type-universe members whose TYPE
 * NAMES are now registered (fixed this session): they resolve, intern, reflect as
 * primitives, and are distinct. The VALUE level (literals, arithmetic, layout) of
 * these types, and the `complex`/`rational` extension types plus the imaginary
 * literal, are deferred (capability R).
 */

// ── float128 and decimal type names ───────────────────────────────────────────
test('numeric types: float128 is a registered type name', () => {
  expect(evaluated('typeof float128;')).toBe('object');
  expect(evaluated('Reflect.getReflection(float128).kind;')).toBe('primitive');
  // interns and is distinct from float64
  expect(ok('type A = float128; type B = float128; A === B;')).toBe(true);
  expect(bool('String(float128 === float64);')).toBe(false);
});

test('numeric types: the decimal types are registered type names', () => {
  expect(evaluated('typeof decimal128;')).toBe('object');
  expect(evaluated('typeof decimal64;')).toBe('object');
  expect(evaluated('typeof decimal32;')).toBe('object');
  // distinct from one another and from float128
  expect(bool('String(decimal128 === decimal64);')).toBe(false);
  expect(bool('String(decimal128 === float128);')).toBe(false);
});

test('numeric types: float128 and decimal are usable in annotation position', () => {
  expect(evaluated('let a: float128; typeof float128;')).toBe('object');
  expect(evaluated('let a: decimal128; typeof decimal128;')).toBe('object');
});

test('numeric types: the type names are shadowable', () => {
  expect(evaluated('let float128 = 5; String(float128);')).toBe('5');
});

// ── Documented gaps: the value level ──────────────────────────────────────────
test('numeric types: a literal in a decimal or float128 type does not convert (documents the gap)', () => {
  // Target (decimal.md): `let a: decimal128 = 1.5` gives a decimal128 value.
  // The value-level conversion/arithmetic is deferred.
  expectThrown('let a: decimal128 = 1.5;');
  expectThrown('let a: float128 = 1.5;');
});

test('numeric types: complex and rational are not registered as usable type names (documents the gap)', () => {
  // Target (complex.md/rational.md): complex.<T> and rational.<T> value types.
  expect(evaluated('typeof complex;')).toBe('undefined');
  expect(evaluated('typeof rational;')).toBe('undefined');
});

test('numeric types: the imaginary literal does not parse (documents the gap)', () => {
  // Target: `4i`, `2.5i`, `1e3i` are imaginary literals typed by the complex
  // extension. The suffix does not lex.
  expectThrown('let a = 3i; typeof a;');
});
