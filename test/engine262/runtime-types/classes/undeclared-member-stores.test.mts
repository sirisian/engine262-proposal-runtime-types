import { test, expect } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * A store to a member the class does not declare (#sec-typed-storage).
 *
 * "It is a type error to assign to a member of a receiver whose type is a class with sealed
 * instances, where the member names no field or accessor the class declares or inherits." The
 * receiver's STATIC type decides, as it does for `this`: a member only a subclass declares is
 * reached through a receiver narrowed to that subclass.
 *
 * The rule was asked only of a value class. Every other typed class was left to the seal, which
 * throws in strict code and is silent in sloppy code, so `counter.cnt = 1` on the ordinary typed
 * class ran, stored nothing and said nothing.
 */

const refused = { bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-undeclared-member' } };
const accepted = (source: string) => expect(observeScript(source).errorClass, source).toBeUndefined();

const heads = ['class', 'value class', 'sealed class', 'abstract class'];

test.each(heads)('a misspelled member is refused wherever it is written: %s', (head) => {
  const C = `${head} Counter { count: uint32 = 0; }`;
  const D = head === 'abstract class' ? `${C} class Tally extends Counter { }` : C;
  const T = head === 'abstract class' ? 'Tally' : 'Counter';
  // `this`, in a method, the constructor and an accessor.
  expect(observeScript(`${head} Counter { count: uint32 = 0; inc() { this.cnt = 1; } }`)).toMatchObject(refused);
  expect(observeScript(`${head} Counter { count: uint32 = 0; constructor() { this.cnt = 1; } }`)).toMatchObject(refused);
  expect(observeScript(`${head} Counter { count: uint32 = 0; get twice(): uint32 { this.cnt = 1; return 2; } }`)).toMatchObject(refused);
  // A parameter, a `const` the type is inferred for, and a field of a field.
  expect(observeScript(`${D} function f(c: ${T}) { c.cnt = 1; }`)).toMatchObject(refused);
  expect(observeScript(`${D} function f() { const c = new ${T}(); c.cnt = 1; }`)).toMatchObject(refused);
  expect(observeScript(`${D} class Holder { c: ${T} = new ${T}(); } function f(h: Holder) { h.c.cnt = 1; }`)).toMatchObject(refused);
  // Every form of store: compound, logical, update, a constant computed key, and a destructuring,
  // `for`-`of` target.
  for (const store of ['c.cnt += 1;', 'c.cnt ??= 1;', 'c.cnt++;', 'c["cnt"] = 1;', '[c.cnt] = [1];', '({ a: c.cnt } = { a: 1 });', 'for (c.cnt of [1]) { }']) {
    expect(observeScript(`${D} function f(c: ${T}) { ${store} }`), store).toMatchObject(refused);
  }
  // The declared member is stored to, and the message names the member and the class.
  expect(evaluated(`${D} function f() { const c = new ${T}(); c.count = 3; return String(c.count); } f();`)).toBe('3');
  expectThrown(`${D} function f(c: ${T}) { c.cnt = 1; }`, `"cnt" is not a member of "${T}"`);
});

test('the static type of the receiver decides, and a subclass is reached by narrowing', () => {
  const H = 'class P { x: uint8 = 0; } class Q extends P { y: uint8 = 0; } ';
  // `y` is not a member of `P`, though the object may be a `Q`.
  expect(observeScript(`${H}function f(p: P) { p.y = 1; }`)).toMatchObject(refused);
  // `is` narrows; `instanceof` runs a hook and does not.
  expect(evaluated(`${H}function f(p: P) { if (p is Q) { p.y = 1; return String(p.y); } return 'no'; } f(new Q());`)).toBe('1');
  expect(observeScript(`${H}function f(p: P) { if (p instanceof Q) { p.y = 1; } }`)).toMatchObject(refused);
  // A conversion to the subclass, and a receiver declared as one.
  expect(evaluated(`${H}function f(p: P) { const q = p := Q; q.y = 2; return String(q.y); } f(new Q());`)).toBe('2');
  expect(evaluated(`${H}function f(q: Q) { q.y = 3; q.x = 4; return String(q.y) + String(q.x); } f(new Q());`)).toBe('34');
  // A subclass that declares nothing is sealed as its base is.
  expect(observeScript('class P { x: uint8 = 0; } class D extends P { } function f(d: D) { d.y = 1; }')).toMatchObject(refused);
  // A base of methods alone adds no member, so its typed subclass is judged.
  expect(observeScript('abstract class Shape { abstract area(): float64; } class Circle extends Shape { r: float64 = 0; area(): float64 { return this.r; } } function f(c: Circle) { c.radius = 1; }'))
    .toMatchObject(refused);
  // A union is judged at each member, and a `null` member by its own rule.
  expect(evaluated(`${H}class Z { y: uint8 = 0; } function f(p: Q | Z) { p.y = 1; return String(p.y); } f(new Z());`)).toBe('1');
  expect(observeScript(`${H}class Z { z: uint8 = 0; } function f(p: Q | Z) { p.y = 1; }`)).toMatchObject(refused);
  expect(observeScript(`${H}function f(p: P | null) { if (p !== null) { p.zz = 1; } }`)).toMatchObject(refused);
  // A generic class, through an application and through `this`.
  expect(observeScript('class Box<T: type> { v: T; constructor(v: T) { this.v = v; } } function f(b: Box.<uint8>) { b.w = 1; }')).toMatchObject(refused);
  expect(observeScript('class Box<T: type> { v: T; constructor(v: T) { this.v = v; } set(v: T) { this.vv = v; } }')).toMatchObject(refused);
});

test('what is declared is stored to', () => {
  // A setter, an inherited field, an untyped field beside a typed one, a private field.
  accepted('class C { #v: uint8 = 0; x: uint8 = 0; set v(n: uint8) { this.#v = n; } } function f(c: C) { c.v = 1; }');
  accepted('class P { x: uint8 = 0; } class Q extends P { y: uint8 = 0; } function f(q: Q) { q.x = 1; }');
  accepted('class C { x: uint8 = 0; loose = 1; } function f(c: C) { c.loose = 2; }');
  accepted('class C { x: uint8 = 0; #p: uint8 = 0; set(n: uint8) { this.#p = n; } }');
  // A static member is a property of the constructor, which is an ordinary function object.
  expect(evaluated('class C { x: uint8 = 0; static count: uint32 = 0; } function f() { C.count = 1; C.other = 2; return String(C.count) + String(C.other); } f();')).toBe('12');
  // A getter with no setter is refused by its own rule.
  expect(observeScript('class C { x: uint8 = 0; get twice(): uint8 { return this.x; } } function f(c: C) { c.twice = 1; }'))
    .toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-readonly-store' } });
});

test('a class is left to the seal where a member may exist that no declaration names', () => {
  // A `dynamic` class is extensible, and so is an untyped one.
  expect(evaluated('dynamic class D { x: uint8 = 0; } function f(d: D) { d.y = 1; return String(d.y); } f(new D());')).toBe('1');
  expect(evaluated('class U { x = 0; } function f(u: U) { u.y = 1; return String(u.y); } f(new U());')).toBe('1');
  // A receiver declared as a `dynamic` subclass is extensible; the same object through its typed
  // base is judged as its base.
  expect(evaluated('class P { x: uint8 = 0; } dynamic class D extends P { } function f(d: D) { d.y = 1; return String(d.y); } f(new D());')).toBe('1');
  expect(observeScript('class P { x: uint8 = 0; } dynamic class D extends P { } function f(p: P) { p.y = 1; }')).toMatchObject(refused);
  // An untyped base with a constructor may have given `this` any property before the seal.
  expect(evaluated('class B { constructor() { this.dyn = 1; } } class C extends B { x: uint8 = 0; } function f(c: C) { c.dyn = 2; return String(c.dyn); } f(new C());')).toBe('2');
  // ...and one with none has given it only what its fields declare.
  accepted('class B { dyn = 1; } class C extends B { x: uint8 = 0; } function f(c: C) { c.dyn = 2; }');
  expect(observeScript('class B { dyn = 1; } class C extends B { x: uint8 = 0; } function f(c: C) { c.zz = 2; }')).toMatchObject(refused);
  // A `dynamic` base, a built-in base whose members the library does not list and a base that
  // is a call are not read.
  accepted('dynamic class B { v: uint8 = 0; } class C extends B { w: uint8 = 1; } function f(c: C) { c.nope = 1; }');
  accepted('class PA extends Array { status: uint16 = 0; } function f(e: PA) { e.statis = 1; }');
  // A built-in base the library lists is read: Error declares `message`, which an instance holds
  // as its own only where its constructor was given one, and no `statis` (Question AP, AP2).
  expect(observeScript('class PE extends Error { status: uint16 = 0; } function f(e: PE) { e.statis = 1; }')).toMatchObject(refused);
  expect(observeScript("class PE extends Error { status: uint16 = 0; } function f(e: PE) { e.message = 'm'; }")).toMatchObject(refused);
  accepted("class PE extends Error { status: uint16 = 0; message: string = ''; } function f(e: PE) { e.message = 'm'; e.status = 1; }");
  accepted('const M = (B) => class extends B { t: uint8 = 0; }; class Base { b: uint8 = 0; } class C extends M(Base) { x: uint8 = 0; } function f(c: C) { c.zz = 1; }');
  // The seal is still what refuses those when they run.
  expectThrown('"use strict"; dynamic class B { v: uint8 = 0; } class C extends B { w: uint8 = 1; } function f(c: C) { c.nope = 1; } f(new C());', 'Cannot set property');
});

test('what the checking pass has no type or key for is left to the seal', () => {
  const C = 'class C { x: uint8 = 0; } ';
  // An `any` receiver, a key that is not known, and a `let` with no annotation.
  accepted(`${C}function f(c: any) { c.y = 1; }`);
  accepted(`${C}function f(c: C, k: string) { c[k] = 1; }`);
  accepted(`${C}function f() { let c = new C(); c.y = 1; }`);
  expectThrown(`${C}function f(c: any) { c.y = 1; } f(new C());`, 'Cannot set property');
  expectThrown(`${C}function f(c: C, k: string) { c[k] = 1; } f(new C(), "y");`, 'Cannot set property');
  // Reading is unaffected: a read adds nothing, and a program may be testing for the absence.
  expect(evaluated(`${C}function f(c: C) { return String(c.y) + typeof c.y; } f(new C());`)).toBe('undefinedundefined');
});
