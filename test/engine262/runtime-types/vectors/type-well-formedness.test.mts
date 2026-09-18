import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

/**
 * Spec: #sec-vector-types with #sec-type-errors.
 *
 * "It is a type error to form `vector.<T, N>` where _T_ is not a lane type or
 * _N_ is not a positive integer, since neither denotes a vector type. Where the
 * lane type is itself a vector, this applies to it in turn."
 *
 * A type error is an Early Error (#sec-type-errors), so a source text
 * containing one is rejected rather than evaluated. The rule lives in
 * `validateVectorType`, which states it once; its only caller was the runtime
 * resolver, so WHICH diagnostic a program got - and whether it got one at all -
 * depended on which resolver reached the annotation first. A binding, an alias
 * and a field reach the runtime one and threw a *TypeError* at evaluation; a
 * parameter and a return annotation are resolved by the checker and were
 * accepted outright, so `function f(v: vector.<uint8, 0>) {}` declared a
 * parameter of a type that does not exist.
 *
 * #sec-evaluatetotypeobject is why the two must agree rather than merely both
 * having a copy: "no separate evaluator is defined". These tests pin the rule at
 * every position a vector type can be written, and pin the one case where it
 * must stand down.
 */

test('a vector with a non-positive lane count is refused, wherever it is written', () => {
  expectStaticTypeError('let v: vector.<uint8, 0>;');
  expectStaticTypeError('type V = vector.<uint8, 0>;');
  expectStaticTypeError('class C { v: vector.<uint8, 0>; }');
  // The two positions the checker resolves itself, which reached no validator
  // at all and so were accepted.
  expectStaticTypeError('function f(v: vector.<uint8, 0>) {}');
  expectStaticTypeError('function f(): vector.<uint8, 0> { return 0; }');
  // A negative count is the same rule, not a separate one.
  expectStaticTypeError('function f(v: vector.<uint8, -4>) {}');
});

test('a vector whose lane type is not a lane type is refused', () => {
  expectStaticTypeError('function f(v: vector.<string, 4>) {}');
  expectStaticTypeError('let v: vector.<string, 4>;');
  expectStaticTypeError('type V = vector.<boolean, 4>;');
  expectStaticTypeError('class C { v: vector.<string, 4>; }');
});

test('the rule reaches a nested lane type in turn', () => {
  // "Where the lane type is itself a vector, this applies to it in turn."
  expectStaticTypeError('function f(v: vector.<vector.<string, 2>, 4>) {}');
  expectStaticTypeError('function f(v: vector.<vector.<uint8, 0>, 4>) {}');
  expectStaticTypeError('let v: vector.<vector.<uint8, 0>, 4>;');
});

test('a well-formed vector stands, in every spelling', () => {
  expect(ok('function f(v: vector.<uint8, 4>) { return 1; }')).toBe(true);
  expect(evaluated('let v: vector.<float32, 4>; String(Reflect.typeOf(v));')).toBe('vector.<float32, 4>');
  expect(evaluated('let v: vector.<vector.<uint8, 4>, 2>; String(Reflect.typeOf(v));')).toBe('vector.<vector.<uint.<8>, 4>, 2>');
  expect(evaluated('type V = vector.<uint8, 8>; let a: V; String(Reflect.typeOf(a));')).toBe('vector.<uint.<8>, 8>');
  // A bit lane is a lane type: `boolean8` is `vector.<uint.<1>, 8>`.
  expect(evaluated('let v: vector.<uint.<1>, 8>; String(Reflect.typeOf(v));')).toBe('vector.<uint.<1>, 8>');
  // The shorthands are the same types and must keep working.
  expect(evaluated('let v: float32x4 = float32x4(1, 2, 3, 4); String(v.lane.<0>());')).toBe('1');
  expect(evaluated('String(Reflect.typeOf(int32x4(1, 2, 3, 4)));')).toBe('vector.<int.<32>, 4>');
  // A method whose result type is a vector is formed by the same path.
  expect(evaluated('let a: float32x4 = float32x4(1, 2, 3, 4); '
    + 'const o: vector.<float32, 2> = a.swizzle.<3, 0>(); String(o.lane.<0>());')).toBe('4');
});

test('the rule stands down where the vector mentions a type parameter', () => {
  // A lane type that is a type PARAMETER is not a lane type yet, and is not a
  // lane type wrongly either. #sec-evaluatetotypeobject defers a type that
  // reads an unbound generic parameter rather than failing it, and
  // #sec-higher-kinded-parameters gives the reason to honour it: a declaration
  // is "checked once rather than once per application".
  //
  // Both resolvers had to learn this. The checker had no validator and so
  // accepted these by accident; the runtime resolver had one and applied it
  // unconditionally, so a generic class could not carry a vector field at all.
  expect(ok('function f<T>(v: vector.<T, 4>) { return v; }')).toBe(true);
  expect(ok('class B<T> { v: vector.<T, 4> | null = null; }')).toBe(true);
  expect(ok('class G<N: uint32> { v: vector.<uint8, N> | null = null; }')).toBe(true);
  expect(ok('type V<N: uint32> = vector.<uint8, N>;')).toBe(true);
});

test('the application is where a bound parameter is judged', () => {
  // The deferral above is not a hole: the argument resolves the parameter and
  // the same rule decides there.
  expect(evaluated('function f<T>(v: vector.<T, 4>): vector.<T, 4> { return v; } '
    + 'let a: float32x4 = float32x4(1, 2, 3, 4); String(Reflect.typeOf(f.<float32>(a)));')).toBe('vector.<float32, 4>');
  expect(evaluated('type V<N: uint32> = vector.<uint8, N>; let a: V.<4>; String(Reflect.typeOf(a));')).toBe('vector.<uint.<8>, 4>');
  // A lane type the application supplies wrongly is still refused.
  expect(ok('class B<T> { v: vector.<T, 4> | null = null; } let b: B.<string> = new B.<string>();')).toBe(false);
});
