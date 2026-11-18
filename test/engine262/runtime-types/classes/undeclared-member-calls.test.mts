import { test, expect } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * A call of a member the class does not declare (#sec-typed-storage).
 *
 * "It is a type error to call a member that the class of the receiver does not declare ... The
 * read of such a member is unaffected: it yields *undefined*, and a program may be testing for
 * that. A call of what it yields cannot succeed."
 *
 * The rule is the one a store has, for the same receivers: a class whose instances are sealed
 * and whose members are all written down. `c.incremnt()` was accepted and was a TypeError when
 * it ran, and was never reported in a function nothing called.
 */

const refused = { bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-undeclared-member' } };
const accepted = (source: string) => expect(observeScript(source).errorClass, source).toBeUndefined();
const C = 'class Counter { count: uint32 = 0; inc() { this.count++; } } ';
const V = 'value class P { x: uint32 = 0; len() { return this.x; } } ';

test('a call of an undeclared member is refused before the program runs', () => {
  expect(observeScript(`${C}const c = new Counter(); c.incremnt();`)).toMatchObject(refused);
  expect(observeScript(`${V}const p = new P(); p.go();`)).toMatchObject(refused);
  // In a function nothing calls, where the run time never met it.
  expect(observeScript(`${C}function f(c: Counter) { c.go(); }`)).toMatchObject(refused);
  expectThrown(`${C}function f(c: Counter) { c.go(); }`, '"go" is not a member of "Counter", so it cannot be called');
  // A constant key is the same member, and so is one reached through a chain or as a tag.
  expect(observeScript(`${C}function f(c: Counter) { c['go'](); }`)).toMatchObject(refused);
  expect(observeScript(`${C}function f(c: Counter | null) { return c?.go(); }`)).toMatchObject(refused);
  expect(observeScript(`${C}function f(c: Counter) { return c.tag\`x\`; }`)).toMatchObject(refused);
  expect(observeScript(`${C}function f(c: Counter) { return new c.Thing(); }`)).toMatchObject(refused);
  expectThrown(`${C}function f(c: Counter) { return new c.Thing(); }`, 'so it cannot be constructed');
});

test('the misspelled call of a method on this is the same call', () => {
  expect(observeScript('class Base { n: uint8 = 0; run() { return this.stpe(); } step() { return 1; } }')).toMatchObject(refused);
  // A method that a subclass supplies is declared where it is called from.
  expect(observeScript('class Base { n: uint8 = 0; run() { return this.step(); } } class Impl extends Base { step() { return 5; } }')).toMatchObject(refused);
  expect(evaluated('abstract class Base { n: uint8 = 0; abstract step(): uint8; run() { return this.step(); } } class Impl extends Base { step(): uint8 { return 5; } } String(new Impl().run());')).toBe('5');
});

test('the read and its tests are ordinary', () => {
  expect(evaluated(`${C}const c = new Counter(); String(c.go) + typeof c.go + String(c.go === undefined);`)).toBe('undefinedundefinedtrue');
  // The optional call is the read with its test.
  expect(evaluated(`${C}const c = new Counter(); String(c.go?.());`)).toBe('undefined');
  accepted(`${C}function f(c: Counter | null) { return c?.go?.(); }`);
  accepted(`${C}function f(c: Counter) { if (c.go) { return 1; } return 0; }`);
  // The call itself is judged where it is written, guarded or not; `?.()` is how it is guarded.
  expect(observeScript(`${C}function f(c: Counter) { if (c.go) { c.go(); } }`)).toMatchObject(refused);
});

test('a declared member is called as before', () => {
  expect(evaluated(`${C}const c = new Counter(); c.inc(); String(c.count);`)).toBe('1');
  expect(evaluated(`${C}class Sub extends Counter { extra: uint8 = 0; } const s = new Sub(); s.inc(); String(s.count);`)).toBe('1');
  expect(evaluated('class G { n: uint8 = 0; get twice() { return () => 2; } } String(new G().twice());')).toBe('2');
  expect(evaluated('class Pm { n: uint8 = 0; #p() { return 1; } q() { return this.#p(); } } String(new Pm().q());')).toBe('1');
  expect(evaluated('class A { n: uint8 = 0; } partial class A { go() { return 1; } } String(new A().go());')).toBe('1');
  expect(evaluated(`${C}const c = new Counter(); c.inc.call(c); String(c.count);`)).toBe('1');
  expect(evaluated(`${C}function f(c: Counter | null) { return c?.inc(); } f(new Counter()); "ok";`)).toBe('ok');
});

test('a member every object has is a member', () => {
  expect(evaluated(`${C}const c = new Counter(); String(c.hasOwnProperty('count')) + typeof c.toString() + String(c.constructor === Counter);`)).toBe('truestringtrue');
  accepted(`${C}function f(c: Counter) { return new c.constructor(); }`);
  accepted(`${C}function f(c: Counter) { return c.valueOf() === c && c.isPrototypeOf(c) && c.propertyIsEnumerable('count') && c.toLocaleString(); }`);
});

test('a receiver typed as a base has the members of the base', () => {
  const S = `${C}class Sub extends Counter { extra: uint8 = 0; reset() { this.count = 0; return 9; } } `;
  expect(observeScript(`${S}const c: Counter = new Sub(); c.reset();`)).toMatchObject(refused);
  // `is` narrows the receiver, and the call is then of a declared member.
  expect(evaluated(`${S}function f(c: Counter) { if (c is Sub) { return c.reset(); } return 0; } String(f(new Sub())) + String(f(new Counter()));`)).toBe('90');
  // A bound of a type parameter is judged as the bound.
  expect(observeScript(`${C}function f<T: type extends Counter>(c: T) { return c.go(); }`)).toMatchObject(refused);
});

test('a union is judged at each of its classes', () => {
  expect(observeScript(`${C}${V}function f(u: Counter | P) { u.go(); }`)).toMatchObject(refused);
  accepted(`${C}class D { k: uint8 = 0; inc() { } } function f(u: Counter | D) { u.inc(); }`);
});

test('not judged where a member may exist that no declaration names', () => {
  // A dynamic class, a class with no typed field, a base that is a call or a built-in, an `any`
  // receiver, a key that is not known, a structural type, and the class object itself.
  expect(evaluated('dynamic class D { n: uint8 = 0; } const d = new D(); d.go = () => 3; String(d.go());')).toBe('3');
  expect(evaluated('class U { run() { return this.step(); } } class I extends U { step() { return 3; } } String(new I().run());')).toBe('3');
  expect(evaluated('const M = (B) => class extends B { hi() { return 1; } }; class Root { r: uint8 = 0; } class K extends M(Root) { k: uint8 = 0; } String(new K().hi());')).toBe('1');
  expect(observeScript('class E extends Error { code: uint8 = 0; } const e = new E("m"); e.go();')).toMatchObject({ bodyEntered: true, errorClass: 'TypeError' });
  accepted(`${C}function f(c: any) { c.go(); }`);
  accepted(`${C}function f(c: Counter, k: string) { return c[k]; }`);
  accepted('interface I { a: uint8; } function f(x: I) { x.go(); }');
  accepted('function f(x: { a: uint8 }) { x.go(); }');
  expect(evaluated(`${C}Counter.make = () => 5; String(Counter.make());`)).toBe('5');
  // A class over an array has the members of an array, which no declaration lists.
  expect(evaluated('value class G extends [4].<uint8> { } const g = new G(); String(g.join(""));')).toBe('0000');
});

test('a super call of a member no base declares is the same call', () => {
  const A = 'class A { n: uint8 = 0; step() { return 1; } } ';
  expect(observeScript(`${A}class B extends A { f() { return super.go(); } }`)).toMatchObject(refused);
  expectThrown(`${A}class B extends A { f() { return super.go(); } }`, '"go" is not a member of "A" or of a class it extends, so `super` cannot call it');
  // An arrow and a field initializer have the class's `super`.
  expect(observeScript(`${A}class B extends A { f() { return (() => super.go())(); } }`)).toMatchObject(refused);
  expect(observeScript(`${A}class B extends A { v = super.go(); }`)).toMatchObject(refused);
  // A member a base declares, however far up, and one every object has.
  expect(evaluated(`${A}class M extends A { } class B extends M { f() { return super.step(); } } String(new B().f());`)).toBe('1');
  expect(evaluated(`${A}class B extends A { f() { return super.toString(); } } typeof new B().f();`)).toBe('string');
  // The optional call is the read with its test.
  expect(evaluated(`${A}class B extends A { f() { return super.go?.(); } } String(new B().f());`)).toBe('undefined');
});

test('a super call is not judged where super is not the class\'s base', () => {
  const A = 'class A { n: uint8 = 0; step() { return 1; } } ';
  // A method of an object literal has the literal's prototype.
  expect(evaluated(`${A}class B extends A { f() { const o = { __proto__: { go() { return 7; } }, m() { return super.go(); } }; return o.m(); } } String(new B().f());`)).toBe('7');
  // A static member has the base constructor, a class with no base has %Object.prototype%,
  // and a dynamic or built-in base may have members no declaration lists.
  accepted(`${A}class B extends A { static f() { return super.go(); } }`);
  accepted('class B { n: uint8 = 0; f() { return super.go(); } }');
  accepted('dynamic class D { n: uint8 = 0; } class B extends D { f() { return super.go(); } }');
  accepted('class B extends Error { f() { return super.go(); } }');
});
