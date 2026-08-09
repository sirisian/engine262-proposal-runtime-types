import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// sec-type-expressions: `|`? IntersectionType and `&`? PrimaryType - a LEADING
// separator, so a type written across several lines can align its members. The
// design documents the union form and uses it in its own `Shape` example, but
// the grammar had no leading alternative and the parser refused it.
//
// It carries no meaning: `| T` is the type T. Being on the base case of each
// production rather than a production of its own, it may appear at most once and
// only before the first member.

test('a union or intersection may lead with its separator', () => {
  // The reported case, written as a reader would.
  expect(evaluated('type Response =\n  | uint32\n  | null;\nlet x: Response = 5; String(Number(x));')).toBe('5');
  // Wherever a type is written, not only in a `type` declaration.
  expect(evaluated('let x: | uint32 | null = 5; String(Number(x));')).toBe('5');
  expect(evaluated('function f(x: | uint32 | null) { return 1; } String(f(5));')).toBe('1');
  expect(evaluated('function f(): | uint32 | null { return 5; } String(Number(f()));')).toBe('5');
  // The intersection has the same rule.
  expect(evaluated('type A = { a: uint8 }; type B = { b: uint8 }; type C = & A & B; "parsed";')).toBe('parsed');
  expect(evaluated('type A = { a: uint8 }; type B = { b: uint8 }; type C =\n  & A\n  & B;\n"parsed";')).toBe('parsed');
});

test('the leading separator means nothing, and comes at most once', () => {
  // `| T` is T, which matters when a second member is still pending.
  expect(evaluated('type R = | uint32; let x: R = 5; String(Number(x));')).toBe('5');
  // The union still discriminates - the leading token changed nothing about it.
  expectThrown('type R = | uint32 | null; let x: R = "s";');
  // At most once, and never without a member after it.
  expectThrown('type R = | | uint32;');
  expectThrown('type R = |;');
  // A type with no leading token is unaffected.
  expect(evaluated('type R = uint32 | null; let x: R = 5; String(Number(x));')).toBe('5');
});
