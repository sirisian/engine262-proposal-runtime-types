import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-where-clauses (the paragraphs on identity and on the relation to the
 * base) and #sec-parameterized-types.
 *
 * A predicate is a function, so a dependent record type's identity is its
 * declaration's identity: two declarations that write the same `where` text declare
 * two types. The refinement is a brand over its base object type: a value of the
 * refinement is usable wherever the base is, and going the other way is a check.
 */

const P = 'type P = { a: uint8, b: uint8 } where this.a < this.b; ';

test('two declarations that write the same where text declare two types', () => {
  expect(evaluated(`${P} type Q = { a: uint8, b: uint8 } where this.a < this.b; String((type P) === (type Q));`)).toBe('false');
  // Assigning one to the other is refused before the source runs: the two are distinct types.
  expectStaticTypeError(`${P} type Q = { a: uint8, b: uint8 } where this.a < this.b; let p: P = { a: 1, b: 2 }; let q: Q = p;`);
});

test('an alias of a dependent record type is that type', () => {
  expect(evaluated(`${P} type R = P; String((type R) === (type P));`)).toBe('true');
});

test('a value of the refinement is usable wherever its base object type is', () => {
  expect(evaluated(`${P} function f(x: { a: uint8, b: uint8 }): uint8 { return x.a; } let p: P = { a: 1, b: 2 }; String(f(p));`)).toBe('1');
});

test('a value of the base is checked, not assumed, where the refinement is required', () => {
  expect(evaluated(`${P} function g(x: P): uint8 { return x.b; } let ok: { a: uint8, b: uint8 } = { a: 1, b: 2 }; String(g(ok));`)).toBe('2');
  expectThrownKind(`${P} function g(x: P): uint8 { return x.b; } let bad: { a: uint8, b: uint8 } = { a: 5, b: 1 }; g(bad);`, 'TypeError');
});
