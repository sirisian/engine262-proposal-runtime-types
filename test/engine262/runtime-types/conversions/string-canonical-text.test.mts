import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * `string` TAKES WHAT HAS A CANONICAL TEXT - at a BOUNDARY, not in the relation.
 *
 * README: "A number, a bigint, and a boolean each have exactly one text that
 * denotes them, and ToString of them is total and loses nothing, so they convert
 * without ceremony. `undefined`, `null`, an object, and a symbol have only a
 * diagnostic text, and are refused."
 *
 * The run time already did this (`isStringConversionSource`); the static check
 * refused the declaration before it could apply.
 *
 * A first repair put the rule in `IsAssignable` and it was wrong. That is the
 * TYPE RELATION, which type-level programming matches on, so it made `1`
 * assignable to `string` and changed what `[1, 'two', 3]` means to a type-level
 * matcher - `corpus/type-challenges/medium-09 - Replace First` caught it. The
 * rule is a CONVERSION at an annotation, and lives in `requireAssignable` beside
 * the other boundary rules.
 *
 * The last test below is the one that tells the two apart, and is the reason
 * this file exists rather than three rows in an existing one.
 */

test('a number, a bigint and a boolean convert at a declaration', () => {
  expect(evaluated('let a: string = 5; String(a);')).toBe('5');
  expect(evaluated('let b: string = 5n; String(b);')).toBe('5');
  expect(evaluated('let c: string = true; String(c);')).toBe('true');
  expect(evaluated('let n: number = 5; let a: string = n; String(a);')).toBe('5');
});

test('and at a parameter and a return, which are boundaries too', () => {
  expect(evaluated('function f(s: string): string { return s; } String(f(7));')).toBe('7');
  expect(evaluated('function g(): string { return 7; } String(g());')).toBe('7');
});

test('what has only a diagnostic text is refused', () => {
  expectThrown('let a: string = undefined;', 'is not assignable to');
  expectThrown('let a: string = null;', 'is not assignable to');
  expectThrown('let a: string = {};', 'is not assignable to');
  expectThrown("let a: string = Symbol('s');", 'is not assignable to');
});

test('a sized numeric type is not a number, and stays refused', () => {
  expectThrown('let n: uint8 = 5; let a: string = n;', 'is not assignable to');
});

test('the TYPE RELATION is unchanged - a number is still not a string', () => {
  // The conversion is a boundary rule. Were it in the relation, this would be
  // true and a type-level matcher would treat `1` as a string.
  expect(evaluated('String(Reflect.isAssignable(number, string));')).toBe('false');
  expect(evaluated('String(Reflect.isAssignable(boolean, string));')).toBe('false');
});
