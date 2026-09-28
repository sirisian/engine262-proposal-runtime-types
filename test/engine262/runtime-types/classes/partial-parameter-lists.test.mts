import { expect, test } from 'vitest';
import { evaluated, expectEarlyError } from '../harness.mts';

// #sec-type-parameters-static-semantics-early-errors and #sec-partial-classes.

test('a parameter list on a partial declaration is a Syntax Error', () => {
  expectEarlyError('class P { x: uint8 = 0; } partial class P<T: type> { m(): uint8 { return 1; } }', 'SyntaxError');
  expectEarlyError('interface I { a: uint8; } partial interface I<T: type> { b: uint8; }', 'SyntaxError');
});

test('an unconditional partial uses the primary generic parameters', () => {
  expect(evaluated('class Box<T: type> { v: T; constructor(v: T) { this.v = v; } } partial class Box { get2(): T { return this.v; } } String(new Box.<uint8>(2).get2());')).toBe('2');
  expect(evaluated('interface I<T: type> { a: T; } partial interface I { b: T; } let i: I.<uint8> = {a: 1, b: 2}; String(i.b);')).toBe('2');
});

test('partials of non-generic declarations are unchanged', () => {
  expect(evaluated('class Q { x: uint8 = 0; } partial class Q { m(): uint8 { return 5; } } String(new Q().m());')).toBe('5');
  expect(evaluated('interface P { n: int32; } partial interface P { u: string; } let p: P = { n: 1, u: "s" }; p.u;')).toBe('s');
});
