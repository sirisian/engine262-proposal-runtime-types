import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError } from '../harness.mts';

/**
 * #sec-isobjectsubtype: "A `readonly` member is covariant ... A writable member
 * is invariant, because covariance there is unsound: were `{ x: Meter }` a
 * subtype of `{ x: float32 }`, a bare `float32` could be written through the
 * supertype view into a slot the program believes holds a `Meter`."
 *
 * The rule was implemented and unreachable. IsSubtype opens with a reflexivity
 * shortcut, `SameTypeWithAssumptions(s, t)`, and that predicate folds the
 * refinement paths in - a literal answers for its base, a parameterized type for
 * its [[Base]]. Two object types whose members merely refined each other came
 * back "the same", so IsSubtype returned true there and never reached the
 * invariance rule. What the clause describes as unsound was admitted, and the
 * value it warns about could be written.
 */

test('a writable member is invariant', () => {
  expect(evaluated('type A = { a: "x" }; type B = { a: string }; String(Reflect.isAssignable(A, B));')).toBe('false');
  expect(evaluated('type A = { a: uint8 }; type B = { a: uint8 | string }; String(Reflect.isAssignable(A, B));')).toBe('false');
});

test('a readonly member is covariant', () => {
  // Nothing can be written through it, so the clause's argument does not apply.
  expect(evaluated('type A = { readonly a: "x" }; type B = { readonly a: string }; String(Reflect.isAssignable(A, B));')).toBe('true');
  expect(evaluated('type A = { readonly a: uint8 }; type B = { readonly a: uint8 | string }; String(Reflect.isAssignable(A, B));')).toBe('true');
});

test('the write the clause warns about is refused', () => {
  expectStaticTypeError('type A = { a: "x" }; type B = { a: string }; let v: A = { a: "x" }; let w: B = v;');
});

test('refinement is untouched: the folds still serve the subtype question', () => {
  expect(evaluated('String(Reflect.isAssignable(type "x", type string));')).toBe('true');
  expect(evaluated("type E = string.<{ brand: 'E' }>; String(Reflect.isAssignable(E, type string));")).toBe('true');
  expect(evaluated('type A = { a: uint8 }; String(Reflect.isAssignable(A, A));')).toBe('true');
});

test('an all-object intersection is its merge, and admits a value of it', () => {
  // #sec-canonicalizetype merges one, a shared member taking the intersection of
  // the arms' types, so this annotation IS `{ a: 5 }`. Held un-canonicalized it
  // reached IsSubtype's `every(m => IsSubtype(s, m))` rule, which asks whether
  // the source is a subtype of each arm AS A WHOLE OBJECT - a question the merge
  // never asks, and one invariance answers no for the arm the merge subsumes.
  expect(evaluated('type T = { a: number } & { a: 5 }; String(T === (type { a: 5 }));')).toBe('true');
  expect(ok('type T = { a: number } & { a: 5 }; let s: { a: 5 } = { a: 5 }; let v: T = s;')).toBe(true);
  // Only where the arms' member types actually reduce. `uint8` is NOT a subtype
  // of `number` here, so `{ a: number } & { a: uint8 }` merges to a member whose
  // type is that irreducible intersection, and a `{ a: uint8 }` is correctly not
  // a value of it.
  expect(ok('type T = { a: number } & { a: uint8 }; let s: { a: uint8 } = { a: 1 }; let v: T = s;')).toBe(false);
});
