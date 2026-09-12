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
 * says "`0.1` ... in a `rational` position is 1/10", and the checker records the
 * literal's DIGITS (`rationalLiterals`) so `NumericValue` builds 1/10 rather than
 * the double nearest it - which a rational, not rounding, would otherwise hold as
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

test('the type has a default, and it is zero', () => {
  // #table-primitive-defaults gives `rational` zero. The branch that answered
  // this was keyed on a NOMINAL record's LibraryName; once rational records were
  // built as primitives it stopped matching and the type lost its default, which
  // no suite caught because nothing declared a rational without an initializer.
  expect(evaluated('let r: rational; String(r);')).toBe('0');
  expect(evaluated('let a: [2].<rational>; String(a.length);')).toBe('2');
});

test('a NON-literal Number converts by its exact value', () => {
  // The rule the literal work established: exactness follows the literal's
  // POSITION. `0.1` written in a rational position is 1/10; a Number that was
  // never in one is a double by the time it arrives, and its exact value is the
  // dyadic expansion. Both are correct, and the pair is the rule.
  expect(evaluated('let r: rational = 0.1; String(r);')).toBe('1/10');
  expect(evaluated('let n = 0.1; let r: rational = n; String(r);'))
    .toBe('3602879701896397/36028797018963968');
});

test('a metadata default may write a bare literal', () => {
  // The case that started this: `primitivemetadata.md` declares `ratio: rational`
  // with `default = { ratio: 1 }`, and every metadata example in that document
  // failed because no literal reached any rational form.
  expect(evaluated('type D = { r: rational }; meta D { default = { r: 1 };'
    + ' subtype(a, b) { return true; } } "ok";')).toBe('ok');
});
