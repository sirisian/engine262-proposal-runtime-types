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

test('numeric types: rational is a registered value type; complex remains deferred', () => {
  // rational.md is implemented as a value type: `rational` is a global and a
  // usable type name. complex.md is its deferred sibling.
  expect(evaluated('typeof rational;')).toBe('function');
  expect(evaluated('let r: rational = rational(1, 2); typeof r;')).toBe('object');
  expect(evaluated('typeof complex;')).toBe('undefined');
});

test('numeric types: the imaginary literal does not parse (documents the gap)', () => {
  // Target: `4i`, `2.5i`, `1e3i` are imaginary literals typed by the complex
  // extension. The suffix does not lex.
  expectThrown('let a = 3i; typeof a;');
});

test('numeric types: a typed value is never strictly equal to a plain number of equal magnitude', () => {
  // A typed value carries its type as part of its identity, so strict equality
  // against a plain number is always false, for integer and float value types
  // alike. The plain magnitude is recovered with Number(), which does compare
  // equal. This underlies why comparisons in these tests extract with Number()
  // before asserting a numeric value.
  expect(evaluated('String((5 := uint8) === 5);')).toBe('false');
  expect(evaluated('String((0 := uint8) === 0);')).toBe('false');
  expect(evaluated('String((0.5 := float32) === 0.5);')).toBe('false');
  expect(evaluated('String(Number((5 := uint8)) === 5);')).toBe('true');
  expect(evaluated('String(Number((0 := uint8)) === 0);')).toBe('true');
});
