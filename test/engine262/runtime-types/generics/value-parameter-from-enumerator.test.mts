import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * generics.md, "Binding a value generic from an argument": a value parameter
 * bound through a formal typed by it binds the argument's value, converted to
 * the parameter's own type, so `f(3)` for `f<N: uint8>(n: N)` binds the `uint8`
 * 3. An enumerator converted to its enum's underlying type is still the
 * enumerator (#sec-enums: the enum is a subtype), so the binding held a value
 * of the enum, and the formal refused the argument that had bound it: `f(E.A)`
 * was a TypeError, "3 (typed) is not assignable to "3"", and so was
 * `f.<E.A>(E.A)`.
 */

const E = 'enum E : uint8 { A = 3, B = 4 } ';
const F = 'function f<N: uint8>(n: N) { return String(N) + " " + String(Reflect.typeOf(N)); } ';

test('a value parameter of the underlying type binds an enumerator\'s value', () => {
  expect(evaluated(`${E}${F}f(E.A);`)).toBe('3 uint.<8>');
  expect(evaluated(`${E}${F}f.<E.A>(E.A);`)).toBe('3 uint.<8>');
  expect(evaluated(`${E}${F}function call(v) { return f(v); } call(E.B);`)).toBe('4 uint.<8>');
  expect(evaluated('enum P { A, B } function h<N: int32>(n: N) { return String(N); } h(P.B);')).toBe('1');
});

test('a value parameter of the enum keeps the enumerator', () => {
  expect(evaluated(`${E}function g<N: E>(n: N) { return String(N === E.A); } g(E.A);`)).toBe('true');
  // And a plain value binds as before.
  expect(evaluated(`${E}${F}f(3);`)).toBe('3 uint.<8>');
});
