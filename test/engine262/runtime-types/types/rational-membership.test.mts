import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * A rational VALUE is a member of a rational type.
 *
 * `rational` is a parameterized primitive (#sec-primitives names it beside
 * `uint`, `int` and `vector`), and once its type records were built as primitives
 * the type had no members at all: `IsOfType` had an arm for a decimal object and
 * none for a rational one, so
 *
 *   const v = rational(1, 10); let r: rational = v;
 *
 * refused the type's own value. Every literal refused for the same reason, since
 * the literal machinery produces exactly such an object.
 *
 * The literal side was already correct and is pinned here too: #sec-literal-types
 * says "`0.1` … in a `rational` position is 1/10", and the checker records the
 * literal's DIGITS (`rationalLiterals`) so `NumericValue` builds 1/10 rather than
 * the double nearest it — which a rational, not rounding, would otherwise hold as
 * 3602879701896397/36028797018963968.
 */

test('the type admits its own values', () => {
  expect(evaluated('const v = rational(1, 10); let r: rational = v; String(r);')).toBe('1/10');
});

test('a literal in a rational position is its exact value', () => {
  expect(evaluated('let r: rational = 0.1; String(r);')).toBe('1/10');
  expect(evaluated('let r: rational = 1; String(r);')).toBe('1');
  expect(evaluated('let r: rational = 0.25; String(r);')).toBe('1/4');
});

test('every position a type appears in', () => {
  expect(evaluated('class C { r: rational = 0.1; } String(new C().r);')).toBe('1/10');
  expect(evaluated('function f(x: rational) { return x; } String(f(0.1));')).toBe('1/10');
  // The return position already worked before this fix and must keep working: it
  // is the one path that never consulted membership.
  expect(evaluated('function f(): rational { return 0.1; } String(f());')).toBe('1/10');
});

test('what is refused stays refused', () => {
  expectThrown('let r: rational = "s";', 'not assignable');
});

test('arithmetic is untouched', () => {
  expect(evaluated('const a = rational(1, 2); const b = rational(1, 3); String(a + b);')).toBe('5/6');
});
