import { expect, test } from 'vitest';
import { evaluated, expectError } from '../harness.mts';

/**
 * `PLAN-remove-typeof-type-operator.md`: `typeof` is not a type operator.
 *
 * JavaScript's `typeof` reports the underlying language type as a string and is
 * unchanged by this proposal (`#sec-runtimetypeof`: "`typeof` is unchanged by
 * this proposal ... RuntimeTypeOf is what reports the type of this proposal").
 * The type query is `Reflect.typeOf(x)`, which `typeprogramming.md` §4.1 states
 * needs no operator of its own: "types are values, so `Reflect.typeOf(x)` in
 * type position is the type query".
 *
 * A `TypeQueryType` node existed in the engine from 2026-07-22 and in neither the
 * specification nor the design, giving two spellings for one query whose names
 * mean different things in the two positions they appear in. This pins the
 * removal, since a grammar production is easy to re-add and nothing else would
 * notice.
 */

test('`typeof` is not a type operator', () => {
  expectError('const q: uint8 = 1; let v: typeof q = 2;');
  expectError('let x = 5; type T = typeof x;');
  expectError('enum C { Zero } type K = keyof typeof C;');
});

test('the type query is written `Reflect.typeOf`', () => {
  // Each row is the replacement for a row above, and the whole reason the
  // operator could go: nothing is lost by removing it.
  expect(evaluated('const q: uint8 = 1; let v: Reflect.typeOf(q) = 2; "ok";')).toBe('ok');
  expect(evaluated('let x = (5 := uint8); type T = Reflect.typeOf(x); (T === uint8) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('enum C { Zero } type K = keyof Reflect.typeOf(C); String("Zero" is K);')).toBe('true');
  // Member paths and the prefix operators keep working over it.
  expect(evaluated('let o = { n: (5 := uint8) }; type A = Reflect.typeOf(o.n); (A === uint8) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('enum C { Zero } type K = keyof (Reflect.typeOf(C)); String("Zero" is K);')).toBe('true');
});

test('JavaScript\'s `typeof` is untouched', () => {
  // The operator this removal is protecting: it still reports a string, and
  // still reports *"number"* for a numeric type, which is the whole reason two
  // spellings of one name were a hazard.
  expect(evaluated('typeof 5;')).toBe('number');
  expect(evaluated('const q: uint8 = 1; typeof q;')).toBe('number');
  expect(evaluated('typeof "s";')).toBe('string');
});

test('`keyof` of the NAME is not the same type, which is why the replacement is `Reflect.typeOf`', () => {
  // The migration trap. An enum name denotes the enum type, whose values are its
  // enumerators; `Reflect.typeOf(C)` denotes the type of the enum OBJECT, whose
  // keys are the enumerator names. A migration that reached for `keyof C`
  // instead would compile and mean something else.
  const C = 'enum C { Zero } ';
  expect(evaluated(`${C}String("Zero" is (keyof Reflect.typeOf(C)));`)).toBe('true');
  expect(evaluated(`${C}String("Zero" is (keyof C));`)).toBe('false');
});
