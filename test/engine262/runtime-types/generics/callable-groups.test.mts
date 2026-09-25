import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectThrown } from '../harness.mts';

/**
 * Plan section 3.8, phase 4 step 1: a function's or method's generic list
 * declares an overload contract, so its specialized cases, and bodyless
 * owners, are declarations the checker analyzes as a group. Selecting a case
 * is step 2; until then a call into a group with a case is refused, statically
 * and at run time, rather than dispatched by value.
 */

const P = `function f<T: type>(x: T): string { return 'generic'; }
function f<uint8>(x: uint8): string { return 'uint8'; }`;

test('A1: an owner and its attached case are accepted as declarations', () => {
  expect(evaluated(`${P} 'declared';`)).toBe('declared');
});

test('A24: a call into a group with a case is deferred, statically and at run time', () => {
  expectEarlyError(`${P} f.<uint8>(3);`, 'StaticTypeError');
  expectThrown(`${P} f.<uint8>(3);`, 'selecting a specialized case of `f` is not supported yet');
  // A call the checker cannot see is refused at run time, not dispatched by value.
  expectThrown(`${P} const g: any = f; g(3);`, 'selecting a specialized case is not supported yet');
});

test('A5: a standalone capture has no slot domain (D4)', () => {
  expectEarlyError('function g<const T>(x: T): string { return "a"; }', 'StaticTypeError');
});

test('A9 and A10: two accepting owners are an error; no accepting owner leaves the case standalone', () => {
  expectThrown(`function f<T: type>(x: T): string { return 'a'; }
    function f<T: type>(x: T, y: string): string { return 'b'; }
    function f<uint8>(x: uint8): string { return 'c'; }`, 'is accepted by two owners');
  expect(evaluated(`function f<A: type, B: type>(a: A, b: B): string { return 'o'; }
    function f<uint8>(x: uint8): string { return 'c'; } 'ok';`)).toBe('ok');
});

test('A11: a case declared twice is an error', () => {
  expectEarlyError(`function g<uint8>(x: uint8): string { return 'a'; }
    function g<uint8>(x: uint8): string { return 'b'; }`, 'StaticTypeError');
});

test('A17, A17b and A18: a bodyless owner needs an attached case, and is not abstract', () => {
  expect(evaluated(`function read<T: type>(): T; function read<boolean>(): boolean { return true; } 'ok';`)).toBe('ok');
  expect(evaluated(`class R { read<T: type>(): T; read<boolean>(): boolean { return true; } } 'ok';`)).toBe('ok');
  expectThrown('function read<T: type>(): T;', 'is a bodyless owner with no attached case');
});

test('A19, A20 and A21: what may not omit a body, or specialize, is unchanged', () => {
  expectThrown('class R { m(): string; }', 'An abstract method requires an abstract class');
  expectThrown('function r(x: string): string;', 'only an owner, whose generic list declares parameters only, may omit its body');
  expectThrown('class B<uint8> {}', 'specialization is not supported yet');
});

test('A22, A22b, A22c and A23: an attached case is a replacement or an additive overload (Q4)', () => {
  // The same parameter list, a narrower return: a replacement; names are free.
  expect(evaluated(`function f<T: type>(x: T): string { return 'g'; }
    function f<uint8>(y: uint8): 'x' { return 'x'; } 'ok';`)).toBe('ok');
  // The same parameter list, a return that is not a subtype: an incompatible replacement.
  expectThrown(`function f<T: type>(x: T): string { return 'g'; }
    function f<uint8>(x: uint8): number { return 1; }`, 'number is not a subtype of it');
  // Another parameter list: additive, whatever it returns.
  expect(evaluated(`function f<T: type>(x: T): string { return 'g'; }
    function f<uint8>(x: uint8, extra: string): number { return 1; } 'ok';`)).toBe('ok');
});

test('an unmarked bodyless generic method in an abstract class keeps its abstract reading', () => {
  // simd.md writes abstract members this way; the owner reading is a concrete class's.
  expect(evaluated(`abstract class V<N: uint32> { lane<I: uint32>(): uint32 where I < N; } 'ok';`)).toBe('ok');
});

test('A24 for methods: a method call into a group with a case is deferred statically', () => {
  const W = `class W { write<T: type>(v: T): string { return 'g'; } write<boolean>(v: boolean): string { return 'b'; } }`;
  expectThrown(`${W} new W().write(true);`, 'selecting a specialized case of `write` is not supported yet');
  expectThrown(`${W} const w = new W(); w.write.<boolean>(true);`, 'selecting a specialized case of `write` is not supported yet');
  expectEarlyError(`${W} new W().write(true);`, 'StaticTypeError');
  // Value overloads and generic methods without cases are untouched.
  expect(evaluated(`class V { m(v: string): string { return 's'; } m(v: number): string { return 'n'; } }
    new V().m('a') + new V().m(1);`)).toBe('sn');
  expect(evaluated(`class G { m<T: type>(v: T): string { return 'g'; } } new G().m.<uint8>(3);`)).toBe('g');
});

test('an owner with a case in an abstract class is an owner, not an abstract member', () => {
  // Its group has a case, so a concrete subclass has no obligation to implement it.
  expect(evaluated(`abstract class R { read<T: type>(): T; read<boolean>(): boolean { return true; } }
    class S extends R {} 'ok';`)).toBe('ok');
  // Without a case it is abstract, and the obligation holds.
  expectThrown(`abstract class R { read<T: type>(): T; } class S extends R {}`, 'does not implement it');
});

test('two owners with one list are told apart by their parameters in the diagnostic', () => {
  expectThrown(`function f<T: type>(x: T): string { return 'a'; }
    function f<T: type>(x: T, y: string): string { return 'b'; }
    function f<uint8>(x: uint8): string { return 'c'; }`, '`f<T: type>(x: T)` and `f<T: type>(x: T, y: string)`');
});
