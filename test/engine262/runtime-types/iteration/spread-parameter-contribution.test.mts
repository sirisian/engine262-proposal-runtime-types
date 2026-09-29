import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-static-iteration-contribution: a required parameter that no other
// argument can fill, and that "rejects both omission and every possible
// yielded value", is a type error at a single trailing spread; "the rule
// applies to ordinary calls, constructor calls and super calls". A fresh
// literal array yields its elements. A mutable array's or collection's storage
// type "does not by itself constrain its Symbol.iterator method", so it
// establishes nothing.

test('a literal array spread is judged by its elements', () => {
  expectStaticTypeError('function f(a: uint8) {} f(...["x"]);');
  expectStaticTypeError('function f(a: uint8, b: uint8) {} f(...["x", "y"]);');
  expectStaticTypeError('class C { constructor(a: uint8) {} } new C(...["x"]);');
  expectStaticTypeError('class B { constructor(a: uint8) {} } class D extends B { constructor() { super(...["x"]); } }');
});

test('literal elements adopt the parameter type, as direct arguments do', () => {
  expect(evaluated('function f(a: uint32, b: uint32) { return a + b; } String(f(...[3, 4]));')).toBe('7');
});

test('a typed array, tuple or collection does not establish what it yields', () => {
  const F = 'function f(a: uint8) {} ';
  for (const source of ['[].<string>', '[string, string]', 'Set.<string>', 'Map.<string, uint8>']) {
    expect(evaluated(`${F}function g(s: ${source}) { f(...s); } 'ok';`)).toBe('ok');
  }
  expect(evaluated('function take(n: uint8): uint8 { return n; } let xs: [].<string> = ["bad"]; xs[Symbol.iterator] = function* () { yield uint8(9); }; String(take(...xs));')).toBe('9');
});

test('an unannotated binding does not participate', () => {
  expect(evaluated('function f(a: uint32, b: uint32) { return a - b; } let arr = [10, 3]; String(f(...arr));')).toBe('7');
});
