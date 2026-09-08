import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * #sec-canonicalizetype and the intern table: two records are one type when they
 * ARE the same, not when either refines the other. The table's own note gives
 * the stake - "two records that denote the same values may still carry different
 * metadata claims, and interning them together loses one".
 *
 * `SameTypeStructural` delegated to a predicate that folds the refinement paths
 * in: a literal answers for its base and a parameterized type for its [[Base]],
 * which is right for the subtype question those folds serve and wrong for this
 * one. So a record declared FIRST captured a later, different one, and the
 * capture was order-dependent - the fold only fires with the refinement on the
 * left. A brand written before its base lost the brand; a literal member written
 * before a `string` member made the two object types one.
 */

const mk = (t: string) => `Reflect.makeType({ kind: 'object', indexSignatures: [], properties: `
  + `[{ name: 'a', type: ${t}, optional: false, readonly: false }] })`;
const pair = (x: string, y: string) => `let A = ${mk(x)}; let B = ${mk(y)}; String(A === B);`;
const E = "type E = string.<{ brand: 'E' }>; ";

test('a literal member and a base member are two types, whichever is written first', () => {
  expect(evaluated(pair('type "x"', 'type string'))).toBe('false');
  expect(evaluated(pair('type string', 'type "x"'))).toBe('false');
  expect(evaluated('type A = { a: "x" }; type B = { a: string }; String(A === B);')).toBe('false');
});

test('a branded member and a brandless one are two types, whichever is written first', () => {
  expect(evaluated(`${E}${pair('E', 'type string')}`)).toBe('false');
  expect(evaluated(`${E}${pair('type string', 'E')}`)).toBe('false');
});

test('the refinement itself is untouched: these are still subtypes', () => {
  // The folds serve the subtype question and keep serving it. Only the intern
  // table's question is answered strictly.
  expect(evaluated('String(Reflect.isAssignable(type "x", type string));')).toBe('true');
  expect(evaluated(`${E}String(Reflect.isAssignable(E, type string));`)).toBe('true');
});

test('a tuple and an object are two types, whatever the tuple can be iterated as', () => {
  // SameTypeWithAssumptions carried two more subtype folds beside the refinement
  // ones: a library nominal against the object type it IMPLEMENTS, and an array
  // or tuple against an object its ITERATION INTERFACE satisfies. Reached from
  // the intern table, the second matched an object record against a tuple
  // already interned, so `Reflect.makeType({ kind: 'object', ... })` handed back
  // a TUPLE Type Object - the kit's `objectOf` returning a tuple.
  expect(evaluated('type T = [1, 2]; type O = { a: uint8 }; String(T === O);')).toBe('false');
  expect(evaluated(`let A = ${mk('uint8')}; type T = [1, 2]; String(A === T);`)).toBe('false');
  // The subtype question those folds answer is untouched.
  expect(evaluated('String(Reflect.isAssignable(type [uint8], type Iterable.<uint8>));')).toBe('true');
});

test('and identical records still intern together', () => {
  expect(evaluated(pair('uint8', 'uint8'))).toBe('true');
  expect(evaluated(`${E}type V = string.<{ brand: 'V' }>; String((type E & V) === (type V & E));`)).toBe('true');
});
