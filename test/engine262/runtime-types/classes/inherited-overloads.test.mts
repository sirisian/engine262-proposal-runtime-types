import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, observeScript, ok } from '../harness.mts';

/**
 * Question BX: overloads across a class chain. README "Methods and
 * Inheritance": "Methods overload by signature like functions. A derived class
 * adds its signatures to the set inherited from the base rather than hiding
 * them, so overload resolution on a derived instance considers both, and
 * `super` restricts resolution to the base's set." #sec-typed-classes: a
 * method whose parameter types are an inherited signature's overrides it, and
 * one whose parameter types differ from every inherited signature's is an
 * overload.
 *
 * The engine hid the base's set, in the checker and at run time: the README's
 * own sample was refused, and a call typed against the base ran the derived
 * body on a converted argument, or threw.
 */

const rule = (name: string) => ({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: name } });

test("the README's sample: a derived class adds an overload, and super resolves against the base", () => {
  expect(evaluated('class A { f(a: uint8): uint8 { return a; } } '
    + 'class B extends A { f(a: string): string { return a; } g(a: uint8): uint8 { return super.f(a) + this.f(a); } } '
    + 'const b = new B(); String(b.f(0)) + b.f("a") + String(b.g(2));')).toBe('0a4');
  // `super` restricts resolution to the base's set.
  expectStaticTypeError('class A { f(a: uint8): string { return "A"; } } class B extends A { f(a: string): string { return "B"; } g(): string { return super.f("s"); } }');
});

test('a call typed against the base runs the base arm the subclass does not override', () => {
  // These ran B's body on "7", threw at a parameter, and ran B's body from A's method.
  expect(evaluated('class A { f(a: uint8): string { return "A" + a; } } class B extends A { f(a: string): string { return "B" + a; } } '
    + 'function g(x: A): string { return x.f(7); } g(new B());')).toBe('A7');
  expect(evaluated('class P { v: uint8 = 1; } class A { f(a: P): string { return "A"; } } class B extends A { f(a: string): string { return "B" + a; } } '
    + 'function g(x: A): string { return x.f(new P()); } g(new B());')).toBe('A');
  expect(evaluated('class A { f(a: uint8): string { return "A"; } h(): string { return this.f(1); } } class B extends A { f(a: string): string { return "B"; } } new B().h();')).toBe('A');
  // Through `any`, resolution is by the arguments' values over both sets.
  expect(evaluated('class A { f(a: uint8): string { return "A"; } } class B extends A { f(a: string): string { return "B"; } } const b: any = new B(); b.f(1) + b.f("s");')).toBe('AB');
});

test('an arm with the same parameter types overrides, and the method stays the function it is', () => {
  expect(evaluated('class A { f(a: uint8): string { return "A"; } } class B extends A { f(a: uint8): string { return "B"; } } '
    + 'function g(x: A): string { return x.f(1); } g(new B()) + new B().f(2);')).toBe('BB');
  expect(evaluated('class A { f(a: uint8): string { return "A"; } } class B extends A { f(a: uint8): string { return "B"; } } '
    + 'String(B.prototype.f.toString().includes("return"));')).toBe('true');
  // A method that keeps an inherited arm is an overload set, and its run-time
  // type has the inherited arm, as its static type does.
  expect(evaluated('class A { f(a: uint8, b: uint8): string { return "A"; } } class B extends A { f(a: string): string { return "B"; } } '
    + 'const f: any = B.prototype.f; String(f.length) + f.name;')).toBe('1f');
  expect(evaluated('class A { f(a: uint8): uint8 { return a; } } class B extends A { f(a: string): string { return a; } } String(Reflect.typeOf(new B().f));'))
    .toBe('(this: its receiver, a: string) => string & (this: its receiver, a: uint.<8>) => uint.<8>');
});

test('an unannotated method is the override of every arm, as in JavaScript', () => {
  expect(evaluated('class A { f(a: uint8): string { return "A"; } } class B extends A { f(a) { return "B"; } } const b: any = new B(); b.f(1) + b.f("s");')).toBe('BB');
  // A typed arm over an untyped base method keeps it as the catch-all.
  expect(evaluated('class A { f(a) { return "A" + typeof a; } } class B extends A { f(a: uint8): string { return "B"; } } const b: any = new B(); b.f(1) + b.f({});')).toBe('BAobject');
});

test('static methods merge as instance methods do', () => {
  expect(evaluated('class A { static s(a: uint8): string { return "A"; } } class B extends A { static s(a: string): string { return "B"; } } B.s(1) + B.s("x");')).toBe('AB');
});

test('a set spans every class of the chain', () => {
  expect(evaluated('class A { f(a: uint8): string { return "A"; } } class B extends A { f(a: string): string { return "B"; } } '
    + 'class C extends B { f(a: boolean): string { return "C"; } } const c = new C(); c.f(1) + c.f("s") + c.f(true);')).toBe('ABC');
  // A static block sees the set the class declares.
  expect(evaluated('let seen = ""; class A { f(a: uint8): string { return "A"; } } '
    + 'class B extends A { f(a: string): string { return "B"; } static { seen = new B().f(1); } } seen;')).toBe('A');
});

test("the base's method is read at the call, as super reads it", () => {
  expect(evaluated('class A { f(a) { return "old"; } } class B extends A { f(a: uint8): string { return "B"; } } '
    + 'A.prototype.f = function (a) { return "new"; }; const b: any = new B(); b.f("x");')).toBe('new');
  // Through a set the class between made: it kept what it read first.
  expect(evaluated('class A { f(a) { return "old"; } } class B extends A { f(a: uint8): string { return "B"; } } '
    + 'class C extends B { f(a: boolean): string { return "C"; } } const c: any = new C(); const first = c.f("x"); '
    + 'A.prototype.f = function (a) { return "new"; }; first + c.f("x");')).toBe('oldnew');
});

test("an inherited arm's types are resolved where it was written", () => {
  expect(evaluated('function make() { type T = uint8; class A { f(a: T): string { return "A"; } } return A; } const Base = make(); '
    + 'class B extends Base { f(a: string): string { return "B"; } } const b: any = new B(); b.f(1) + b.f("s");')).toBe('AB');
});

test('a built-in method is not merged: a subclass replaces it, as in JavaScript', () => {
  expect(evaluated('class E extends Error { code: uint8 = 0; toString(x: uint8): string { return "E" + x; } } const e = new E("m"); e.toString(3);')).toBe('E3');
  expectStaticTypeError('class E extends Error { code: uint8 = 0; toString(x: uint8): string { return "E" + x; } } const e = new E("m"); e.toString();');
});

test('an overload ambiguous with an inherited one for some argument list is refused at the class', () => {
  expect(observeScript('class A { f(a: uint8): string { return "A"; } } class B extends A { f(a: uint8, b: string = "b"): string { return "B"; } }'))
    .toMatchObject(rule('rt-overload-declaration'));
  // Unrelated parameter types are not ambiguous.
  expect(ok('class A { f(a: uint8): uint8 { return a; } } class B extends A { f(a: string): string { return a; } }')).toBe(true);
});

test('an arm the run time may select in place of another must return a subtype of its return', () => {
  const AD = 'class Animal { n: uint8 = 0; } class Dog extends Animal { m: uint8 = 0; } ';
  // A derived arm more specific than the inherited one, so a call typed against the base may run it.
  expect(observeScript(`${AD}class A { f(a: Animal): string { return "A"; } } class B extends A { f(a: Dog): uint8 { return 1; } }`))
    .toMatchObject(rule('rt-inherited-contract'));
  // An inherited arm more specific than the derived one.
  expect(observeScript(`${AD}class A { f(a: Dog): uint8 { return 1; } } class B extends A { f(a: Animal): string { return "B"; } }`))
    .toMatchObject(rule('rt-inherited-contract'));
  // A covariant return is the narrowing an override may make.
  expect(evaluated(`${AD}class A { f(a: Animal): Animal { return a; } } class B extends A { f(a: Dog): Dog { return a; } } `
    + 'function g(x: A, a: Animal): Animal { return x.f(a); } String(g(new B(), new Dog()) instanceof Dog);')).toBe('true');
});

test('an abstract arm is an obligation of its own', () => {
  // An arm with other parameter types is an overload, which leaves the abstract arm unimplemented.
  expect(observeScript('abstract class A { abstract m(a: uint8): string; } class B extends A { m(a: string): string { return "B"; } }'))
    .toMatchObject(rule('rt-inherited-contract'));
  // An abstract subclass may add one, and a class below it implements the abstract arm.
  expect(evaluated('abstract class A { abstract m(a: uint8): string; } abstract class B extends A { m(a: string): string { return "B"; } } '
    + 'class C extends B { m(a: uint8): string { return "C"; } } const c = new C(); c.m(1) + c.m("s");')).toBe('CB');
  // A compatible arm with fewer parameters still implements it.
  expect(evaluated('abstract class A { abstract m(a: uint8, b: uint8): uint8; } class B extends A { m(a: uint8): uint8 { return a; } } '
    + 'function g(x: A): uint8 { return x.m(1, 2); } String(g(new B()));')).toBe('1');
  // An arm with its parameter types that changes the return is refused as an override is.
  expectStaticTypeError('abstract class A { abstract m(a: uint8): uint8; } class B extends A { m(a: uint8): string { return "x"; } }');
});

test('an interface a class implements is checked against the set, by the checker and the run time', () => {
  // The run time's check of the claim read B's own arm alone and refused it.
  expect(evaluated('interface Has { get(a: string): string; } class A { get(a: string): string { return "s"; } } '
    + 'class E extends A implements Has { get(a: uint8): string { return "u"; } } const e = new E(); e.get(1) + e.get("x");')).toBe('us');
  expect(observeScript('interface Has { get(a: boolean): string; } class A { get(a: string): string { return "s"; } } '
    + 'class E extends A implements Has { get(a: uint8): string { return "u"; } }')).toMatchObject(rule('rt-implements-contract'));
  // A member the class inherits and an interface names keeps its type.
  expectStaticTypeError('interface Has { get(): string; } class A { get(): string { return "a"; } } class E extends A implements Has {} const s: uint8 = new E().get();');
  expect(observeScript('interface Has { get(): string; } class A { get(): string { return "a"; } } class E extends A implements Has {} partial class E { get(): string { return "p"; } }'))
    .toMatchObject(rule('rt-duplicate-member'));
});

test('a partial class leaves the methods the class defined as they are', () => {
  expect(evaluated('class A { m(a: string): string { return "A"; } } class B extends A { m(a: uint8): string { return "B"; } } '
    + 'const m = B.prototype.m; partial class B { n(): string { return "n"; } } String(B.prototype.m === m) + new B().n();')).toBe('truen');
});

test('a group with a specialized case is not made a set with its base', () => {
  const W = 'class W { write<T: type>(v: T): string { return "g"; } write<boolean>(v: boolean): string { return "b"; } } ';
  // A method of the name replaces the group, as in JavaScript.
  expectStaticTypeError(`${W}class X extends W { write(v: uint8): string { return "u"; } } new X().write(true);`);
  expect(evaluated(`${W}class X extends W { write(v: uint8): string { return "u"; } } const x: any = new X(); x.write(1);`)).toBe('u');
  // And the group replaces a base's method.
  expect(evaluated('class A { write(v: string): string { return "s"; } } class X extends A { write<T: type>(v: T): string { return "g"; } write<boolean>(v: boolean): string { return "b"; } } '
    + 'const x = new X(); x.write(true) + x.write("q");')).toBe('bg');
});

test('an arm that overrides every inherited one by its resolved types is called as it would be alone', () => {
  // Written differently (`a: any` against `a`), so the class made it a set; a
  // missing argument binds undefined, as it does in a call of the function.
  expect(evaluated('class A { f(a) { return "A"; } } class B extends A { f(a: any): string { return "B"; } } new B().f();')).toBe('B');
});
