import { test, expect } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * Arguments to a typed class that declares no constructor (#sec-typed-classes).
 *
 * `value class Point { x: float32 = 0; y: float32 = 0; }` declares its members and no
 * constructor. `new Point(1, 2)` made a point at the origin: the constructor the language supplies
 * takes any arguments and uses none, so both were dropped without a word. A typed class declares
 * what it has, and a call checks its arguments against what the callee declares, so the two
 * arguments are refused before the program runs, as a third argument to a function of two
 * parameters is.
 *
 * The refusal is the checker's. What a construction does when it runs is unchanged, so a
 * construction the checker cannot see into - through `any`, a spread, `Reflect.construct` - drops
 * its arguments as it always has.
 */

const early = { bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-call-argument' } };
const accepted = (source: string) => expect(observeScript(source).errorClass, source).toBeUndefined();

test('a typed class with no constructor takes no arguments', () => {
  expect(observeScript('class P { x: uint8 = 0; y: uint8 = 0; } new P(1, 2);')).toMatchObject(early);
  expect(observeScript('value class P { x: float32 = 0; y: float32 = 0; } new P(1, 2);')).toMatchObject(early);
  expect(observeScript('class B<T: type> { v: T | null = null; } new B.<uint8>(1);')).toMatchObject(early);
  expect(observeScript('interface I { x: uint8; } class P implements I { x: uint8 = 0; } new P(1);')).toMatchObject(early);
  expect(observeScript('const P = class { x: uint8 = 0; }; new P(1);')).toMatchObject(early);
  // A field annotated `any` is an annotated field, so the class is typed.
  expect(observeScript('class P { x: any = 0; } new P(1);')).toMatchObject(early);
  // Target-typed construction is the same construction.
  expect(observeScript('class P { x: uint8 = 0; } const p: P = new.(1);')).toMatchObject(early);
  expectThrown('class Point { x: uint8 = 0; y: uint8 = 0; } new Point(1, 2);', 'declares no constructor, so it takes no arguments');
});

test('with none it constructs as before', () => {
  expect(evaluated('class P { x: uint8 = 7; } String(new P().x) + String((new P).x);')).toBe('77');
  expect(evaluated('value class P { x: float32 = 1.5; } const p: P = new.(); String(p.x);')).toBe('1.5');
  expect(evaluated('class B<T: type> { v: T | null = null; } String(new B.<uint8>().v);')).toBe('null');
});

test('the constructor a base declares is the one a derived class without one runs', () => {
  const A = 'class A { x: uint8 = 0; constructor(x: uint8) { this.x = x; } } ';
  expect(evaluated(`${A}class D extends A { y: uint8 = 0; } String(new D(5).x);`)).toBe('5');
  expect(evaluated(`${A}class D extends A { } class E extends D { z: uint8 = 0; } String(new E(6).x);`)).toBe('6');
  // No class of the chain declares one, so the chain takes none.
  expect(observeScript('class A { x: uint8 = 0; } class D extends A { y: uint8 = 0; } new D(5);')).toMatchObject(early);
  expect(observeScript('abstract class A { x: uint8 = 0; } class D extends A { } new D(1);')).toMatchObject(early);
  expect(observeScript('class U { } class D extends U { x: uint8 = 0; } new D(1);')).toMatchObject(early);
  // And `super(...)` is a call of the base's constructor, judged the same way.
  expect(observeScript('class A { x: uint8 = 0; } class D extends A { constructor() { super(1); } }')).toMatchObject(early);
  expect(evaluated('class A { x: uint8 = 3; } class D extends A { constructor() { super(); } } String(new D().x);')).toBe('3');
});

test('a constructor the class writes is judged as it is written', () => {
  // With no annotation it is an untyped function, which takes any arguments and may read them.
  expect(evaluated('class P { x: uint8 = 0; constructor() { this.x = arguments.length; } } String(new P(1, 2).x);')).toBe('2');
  expect(evaluated('class P { x: uint8 = 0; constructor(a) { this.x = a; } } String(new P(5, 6).x);')).toBe('5');
  // With one it is a typed signature, and its arity is the call's.
  expect(observeScript('class P { x: uint8 = 0; constructor(a: uint8) { this.x = a; } } new P(1, 2);')).toMatchObject(early);
});

test('what the checker cannot read, and what declares nothing, is left alone', () => {
  // A class with no type syntax is the language's own, and its constructor takes anything.
  accepted('class U { } new U(1, 2);');
  accepted('class U { m() { return 1; } } new U(1, 2);');
  accepted('class P { #x = 0; get x() { return this.#x; } } new P(1);');
  accepted('class P { m(a: uint8): uint8 { return a; } } new P(1);');
  accepted('class P { static n: uint8 = 0; } new P(1);');
  // A `dynamic` class has asked to be the class the language gives it.
  expect(evaluated('dynamic class P { x: uint8 = 4; } String(new P(1, 2).x);')).toBe('4');
  expect(evaluated('dynamic class A { x: uint8 = 4; } class D extends A { y: uint8 = 0; } String(new D(1).x);')).toBe('4');
  // A base that declares a constructor is the one that runs, typed or not.
  expect(evaluated('class U { constructor(a) { this.a = a; } } class D extends U { x: uint8 = 0; } String(new D(5).a);')).toBe('5');
  // A base that is a built-in or a computed class has a constructor this pass does not read.
  expect(evaluated('class L extends Array { n: uint8 = 0; } String(new L(3).length);')).toBe('3');
  accepted('const M = (B) => class extends B { }; class A { } class D extends M(A) { x: uint8 = 0; } new D(1);');
  // A spread may supply nothing, and a constructor reached as a value is not judged at the call.
  expect(evaluated('class P { x: uint8 = 4; } const a = []; String(new P(...a).x);')).toBe('4');
  expect(evaluated('class P { x: uint8 = 4; } const C: any = P; String(new C(1).x);')).toBe('4');
  expect(evaluated('class P { x: uint8 = 4; } function mk(C) { return new C(1, 2); } String(mk(P).x);')).toBe('4');
  expect(evaluated('class P { x: uint8 = 4; } String(Reflect.construct(P, [1]).x);')).toBe('4');
});
