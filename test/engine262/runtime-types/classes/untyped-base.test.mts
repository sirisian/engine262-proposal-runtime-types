import { test, expect } from 'vitest';
import {
  evaluated, expectThrown, expectStaticTypeError, observeScript,
} from '../harness.mts';

/**
 * A typed class over a base that is not a typed class (#sec-typed-classes).
 *
 * "A typed class is a value type class when every one of its fields has a type that is a value type",
 * and the fields are "the class's own and those it inherits". A base that is an untyped class, a
 * `dynamic` class, a function or a built-in - `Error`, `Map`, `HTMLElement` - gives its instances
 * state no field declares: own properties its constructor makes, and for a built-in its internal
 * slots. A copy "runs no constructor and no field initializer" (#sec-value-type-copying), so a copy of
 * such an instance would be its typed fields and nothing else. So a class over such a base is typed
 * and sealed and is NOT a value type class: it is held by reference, as the design states of a mixin
 * ("applying one to a dynamic or untyped base produces an ordinary reference type") and of an error
 * ("`Error` and its subclasses are reference types").
 *
 * It was copied. `class E extends Error { status: uint16; }` passed to a parameter of type `E`
 * arrived with no `message`, no `stack` and no [[ErrorData]], and two of them with different messages
 * were `===`.
 */

const E = "class PE extends Error { status: uint16; constructor(m: string, s: uint16) { super(m); this.status = s; } } ";

test('an error with a typed field keeps what Error made of it', () => {
  // A second name, a parameter, a return, a field and an element: none of them is a copy.
  expect(evaluated(`${E}function f() { const e = new PE('nf', 404); const c = e; return c.message + String(c.status) + String(Object.getOwnPropertyNames(c)) + Object.prototype.toString.call(c); } f();`))
    .toBe('nf404message,status[object Error]');
  expect(evaluated(`${E}function wrap(e: PE): string { return e.message + String(e.status); } wrap(new PE('nf', 404));`)).toBe('nf404');
  expect(evaluated(`${E}function mk(): PE { const e = new PE('nf', 404); return e; } mk().message;`)).toBe('nf');
  expect(evaluated(`${E}class Err { error: PE | null = null; constructor(e: PE) { this.error = e; } } String(new Err(new PE('nf', 404)).error?.message);`)).toBe('nf');
  expect(evaluated(`${E}const xs: [].<PE> = [new PE('a', 1), new PE('b', 2)]; xs[1].message + String(xs.at(0)?.message);`)).toBe('ba');
  // Thrown and caught, with and without a type on the clause.
  expect(evaluated(`${E}function f() { const e = new PE('nf', 404); try { throw e; } catch (x: PE) { const y = x; return y.message + String(y === e); } } f();`)).toBe('nftrue');
});

test('it is held by reference: one object under every name, compared by identity', () => {
  expect(evaluated(`${E}function bump(e: PE) { e.status = 500; } function f() { const e = new PE('a', 1); bump(e); const c = e; c.status += 1; return String(e.status); } f();`)).toBe('501');
  // Two errors with the same typed fields are two errors.
  expect(evaluated(`${E}function f() { const a = new PE('one', 404); const b = new PE('two', 404); const u: any = { a, b }; return String(u.a === u.b) + String(u.a === u.a) + String(new Set([a]).has(b)); } f();`))
    .toBe('falsetruefalse');
  expect(evaluated(`${E}function f() { const m = new Map(); const a = new PE('a', 1); m.set(a, 1); return String(m.get(new PE('a', 1))) + String(m.get(a)); } f();`)).toBe('undefined1');
  // An element read is the element, and a loop reaches it.
  expect(evaluated(`${E}function f() { const xs: [].<PE> = [new PE('a', 1)]; for (const e of xs) { e.status = 7; } return String(xs[0].status); } f();`)).toBe('7');
  // A member of it is a reference, so `readonly` and a frozen holder fix the reference and not the object.
  expect(evaluated(`${E}class H { readonly e: PE = new PE('a', 1); } function f() { const h = new H(); h.e.status = 9; return String(h.e.status); } f();`)).toBe('9');
});

test('it is typed and sealed all the same', () => {
  expect(evaluated(`${E}const e = new PE('a', 1); String(Object.isExtensible(e)) + String(Object.isFrozen(Object.getPrototypeOf(e)));`)).toBe('falsetrue');
  expectThrown(`${E}const u: any = new PE('a', 1); u.status = 'x';`, 'is not a conversion source');
  expectThrown(`${E}const u: any = new PE('a', 1); u.extra = 1;`);
  // Frozen as an instance of a typed class is.
  expect(evaluated(`${E}function f() { const a = new PE('a', 1); Object.freeze(a); let r = 'ok'; try { a.status = 5; } catch (e) { r = e.name; } return r + a.message; } f();`)).toBe('TypeErrora');
});

test('it has no layout and no default, and is no value type', () => {
  expect(evaluated(`${E}String(PE.hasLayout) + String(Reflect.isAssignable(PE, value));`)).toBe('falsefalse');
  expectThrown(`${E}PE.byteLength;`, 'has no layout');
  // No constructor ran, so there is no Error to be the default.
  expectThrown(`${E}let e: PE;`, 'has no default value');
  // A field of it with no initializer is its constructor's to assign (classes/constructor-assigned-fields.test.mts).
  expectThrown(`${E}class H { e: PE; } new H();`, 'has no default value');
  expectStaticTypeError(`${E}class Store<T: type extends value> { xs: [].<T> = []; } new Store.<PE>();`);
  expectThrown(`${E}new SoA.<PE>(2);`, 'cannot be split into columns: it is not a value class');
});

test('a subclass of one is one, and is held at a position of its base', () => {
  // A reference holds any subclass, so a subclass that adds a field is not refused.
  expect(evaluated(`${E}class NF extends PE { path: uint8 = 3; constructor() { super('nf', 404); } } function f(e: PE): string { const u: any = e; return e.message + String(e instanceof NF) + String(u.path); } f(new NF());`))
    .toBe('nftrue3');
  expect(evaluated(`${E}class NF extends PE { constructor() { super('nf', 404); } } String(NF.hasLayout) + String(Reflect.isAssignable(NF, value));`)).toBe('falsefalse');
});

test('every base that is not a typed class gives the same answer', () => {
  const tail = "function f() { const a = new K(); const b = a; b.n = 5; const x = new K(); const y = new K(); const u: any = { x, y }; return String(a.n) + String(u.x === u.y) + String(K.hasLayout) + String(Reflect.isAssignable(K, value)); } f();";
  // An untyped class whose constructor makes a property, one with an untyped field, and an empty one.
  expect(evaluated(`class B { constructor() { this.tag = 'b'; } } class K extends B { n: uint8; } ${tail}`)).toBe('5falsefalsefalse');
  expect(evaluated(`class B { tag = 'b'; } class K extends B { n: uint8; } ${tail}`)).toBe('5falsefalsefalse');
  expect(evaluated(`class B { } class K extends B { n: uint8; } ${tail}`)).toBe('5falsefalsefalse');
  // A `dynamic` class, a function, a built-in collection, a class a function returns.
  expect(evaluated(`dynamic class B { m: uint8; } class K extends B { n: uint8; } ${tail}`)).toBe('5falsefalsefalse');
  expect(evaluated(`function B() { this.tag = 'f'; } class K extends B { n: uint8; } ${tail}`)).toBe('5falsefalsefalse');
  expect(evaluated(`class K extends Map { n: uint8; } ${tail}`)).toBe('5falsefalsefalse');
  expect(evaluated(`class U { } const mix = (B) => class extends B { t: uint8; }; class K extends mix(U) { n: uint8; } ${tail}`)).toBe('5falsefalsefalse');
  // The kind is inherited: a typed class between this one and the untyped root changes nothing.
  expect(evaluated(`class A { } class B extends A { b: uint8; } class K extends B { n: uint8; } ${tail}`)).toBe('5falsefalsefalse');
  // What the copy lost.
  expect(evaluated("class B { constructor() { this.tag = 'b'; } } class K extends B { n: uint8; } function f() { const a = new K(); const b = a; const u: any = { b }; return String(u.b.tag); } f();")).toBe('b');
  expect(evaluated("class K extends Map { n: uint8; } function f(k: K) { return String(k.get('a')) + String(k.size); } const k = new K(); k.set('a', 1); f(k);")).toBe('11');
});

test('a class over a typed base is a value type class as before', () => {
  const tail = "function f() { const a = new K(); const b = a; b.n = 5; const x = new K(); const y = new K(); const u: any = { x, y }; return String(a.n) + String(b.n) + String(u.x === u.y) + String(K.byteLength); } f();";
  expect(evaluated(`value class B { m: uint8; } value class K extends B { n: uint8; } ${tail}`)).toBe('05true2');
  expect(evaluated(`value class A { a: uint8; } value class B extends A { } value class K extends B { n: uint8; } ${tail}`)).toBe('05true2');
  expect(evaluated(`const B = value class { x: uint8; }; value class K extends B { n: uint8; } ${tail}`)).toBe('05true2');
  expect(evaluated(`value class Box<T: type extends value> { v: T; } value class K extends Box.<uint8> { n: uint8; } ${tail}`)).toBe('05true2');
  // A mixin over a value type base "produces a value type class".
  expect(evaluated(`value class P { x: uint8; } const Tagged = (B) => value class extends B { t: uint8; }; value class K extends Tagged(P) { n: uint8; } ${tail}`)).toBe('05true3');
  expect(evaluated(`value class K { n: uint8; } ${tail}`)).toBe('05true1');
});

test('the checking pass does not judge a store to one as a store to a copy', () => {
  // #sec-store-to-a-copy has no false instance: the store below reaches the caller's object.
  expect(evaluated('class U { } class K extends U { n: uint8; } function f(k: K) { k.n = 5; } function g() { const k = new K(); f(k); return String(k.n); } g();')).toBe('5');
  expect(evaluated(`${E}function f(e: PE) { e.status = 5; } function g() { const e = new PE('a', 1); f(e); return String(e.status); } g();`)).toBe('5');
  // The control: over a typed base the parameter is a copy and the store is lost.
  expect(observeScript('value class U { u: uint8; } value class K extends U { n: uint8; } function f(k: K) { k.n = 5; } f(new K());'))
    .toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-store-to-copy' } });
  // And a default of it is refused where the class is known.
  expect(observeScript('class U { } class K extends U { n: uint8; } let k: K;'))
    .toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-missing-default' } });
});
