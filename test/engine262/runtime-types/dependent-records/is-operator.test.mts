import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-is-operator, with #sec-where-clauses.
 *
 * `v is T` is true when the value of `v` is of the type `T` denotes and false
 * otherwise. It performs IsOfType and never throws for a value the type rejects,
 * which is the difference between it and the check a boundary performs: a boundary
 * requires, and `is` asks. Against a dependent record type it runs the predicates.
 */

const P = 'type P = { a: uint8, b: uint8 } where this.a < this.b; ';

test('is answers true for a value every predicate accepts', () => {
  expect(evaluated(`${P} var v: any = { a: (1 := uint8), b: (2 := uint8) }; String(v is P);`)).toBe('true');
});

test('is answers false, without throwing, for a value a predicate rejects', () => {
  expect(evaluated(`${P} var v: any = { a: (5 := uint8), b: (1 := uint8) }; String(v is P);`)).toBe('false');
});

test('the same rejected value is refused, with a TypeError, at a boundary', () => {
  // The contrast the clause draws: `is` asks, a boundary requires.
  expectThrownKind(`${P} var v: any = { a: (5 := uint8), b: (1 := uint8) }; let p: P = v;`, 'TypeError');
});

test('is is the way to ask whether a mutated value is valid again', () => {
  expect(evaluated(`${P} let p: P = { a: 1, b: 2 }; p.a = 9; const broken = p is P; p.a = 0; String(broken) + '/' + String(p is P);`))
    .toBe('false/true');
});

test('against any other type is the ordinary structural test', () => {
  expect(evaluated('var v: any = { x: (1.5 := float32) }; String(v is { x: float32 });')).toBe('true');
  expect(evaluated('var v: any = 5; String(v is uint8);')).toBe('false');
  expect(evaluated('var v: any = (5 := uint8); String(v is uint8);')).toBe('true');
});
