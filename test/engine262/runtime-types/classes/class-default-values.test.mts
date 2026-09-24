import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-default-values and #sec-defaultvalueof.
 *
 * "It is a type error to declare a binding or a field with a type _t_ and no
 * initializer when DefaultValueOf(_t_) is ~none~." A class has a default only
 * through a declared zero, or field by field as a value type class. Class types
 * were left to the evaluation of the declaration, so `let q: Q;` was refused
 * only when it ran, and a field `q: Q` or a declaration in a function nothing
 * called was never refused.
 */

const Q = 'class Q { g: () => void = () => {}; } ';

test('a class-typed declaration with no default is refused before the program runs', () => {
  expectStaticTypeError(`${Q} let q: Q;`);
  expectStaticTypeError(`${Q} let t: [Q, Q];`);
  expectStaticTypeError(`${Q} class H { q: Q; }`);
  expectStaticTypeError(`${Q} function f() { let d: [10].<Q>; }`);
});

test('value type classes, declared zeros, nullable unions and dynamic arrays have defaults', () => {
  expect(evaluated('class V { x: float32 = 0; } let e: [4].<V>; String(e[0].x);')).toBe('0');
  expect(evaluated('class S { s: string = "a"; n: uint8 = 0; } let s: S; String(s.s.length);')).toBe('0');
  expect(evaluated('class Z { g: () => void = () => {}; static default = new Z(); } let z: Z; typeof z.g;')).toBe('function');
  expect(evaluated(`${Q} let q: Q | null; String(q);`)).toBe('null');
  expect(evaluated(`${Q} let d: [].<Q>; String(d.length);`)).toBe('0');
});
