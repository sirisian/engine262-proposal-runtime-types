import { expect, test } from 'vitest';
import { evaluated, expectError } from '../harness.mts';

/**
 * `typeof` is not a type operator.
 *
 * JavaScript's `typeof` reports the underlying language type as a string and is
 * unchanged by this proposal (`#sec-runtimetypeof`: "`typeof` is unchanged by this
 * proposal ... RuntimeTypeOf is what reports the type of this proposal"). The type
 * query is `Reflect.typeOf(x)` (#sec-reflect-typeof), which needs no operator of its
 * own: types are values, so `Reflect.typeOf(x)` in type position is the type query.
 *
 * The grammar therefore has no type-query production: a second spelling of one query,
 * whose name means different things in the two positions it appears in, would be a
 * hazard. A grammar production is easy to add back and nothing else would notice, so
 * its absence is pinned here.
 */

test('`typeof` is not a type operator', () => {
  expectError('const q: uint8 = 1; let v: typeof q = 2;');
  expectError('let x = 5; type T = typeof x;');
  expectError('enum C { Zero } type K = keyof typeof C;');
});

test('the type query is written `Reflect.typeOf`', () => {
  // Each row is the `Reflect.typeOf` replacement for a row above: nothing is lost by
  // the operator's absence.
  expect(evaluated('const q: uint8 = 1; let v: Reflect.typeOf(q) = 2; "ok";')).toBe('ok');
  // The binding is `const`: a type position is compile-time evaluable, and a
  // read of a `let` is not (#sec-iscompiletimeevaluable).
  expect(evaluated('const x = (5 := uint8); type T = Reflect.typeOf(x); (T === uint8) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('enum C { Zero } type K = keyof Reflect.typeOf(C); String("Zero" is K);')).toBe('true');
  // Member paths and the prefix operators keep working over it.
  // The binding is `const`: a type position is compile-time evaluable, and a
  // read of a `let` is not (#sec-iscompiletimeevaluable).
  expect(evaluated('const o = { n: (5 := uint8) }; type A = Reflect.typeOf(o.n); (A === uint8) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('enum C { Zero } type K = keyof (Reflect.typeOf(C)); String("Zero" is K);')).toBe('true');
});

test('JavaScript\'s `typeof` is untouched', () => {
  // The operator itself is unchanged: it still reports a string, and still reports
  // *"number"* for a numeric type, which is why two spellings of one name would be a
  // hazard.
  expect(evaluated('typeof 5;')).toBe('number');
  expect(evaluated('const q: uint8 = 1; typeof q;')).toBe('number');
  expect(evaluated('typeof "s";')).toBe('string');
});

test('`keyof` of the NAME is not the same type, which is why the replacement is `Reflect.typeOf`', () => {
  // An easy confusion. An enum name denotes the enum type, whose values are its
  // enumerators; `Reflect.typeOf(C)` denotes the type of the enum OBJECT, whose keys are
  // the enumerator names. Reaching for `keyof C` instead would compile and mean
  // something else.
  const C = 'enum C { Zero } ';
  expect(evaluated(`${C}String("Zero" is (keyof Reflect.typeOf(C)));`)).toBe('true');
  expect(evaluated(`${C}String("Zero" is (keyof C));`)).toBe('false');
});
