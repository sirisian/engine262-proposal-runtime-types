import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * An instance of a typed class that no constructor built is an instance of that class all the same.
 *
 * The engine builds one in two places. A value type class "defaults field by field, without running its
 * field initializers or its constructor" (#sec-default-values): a binding, a field and an array element
 * declared without an initializer. And a typed boundary copies a value by assembling it from its layout
 * (#sec-value-type-copying): a parameter, a return, a binding, a store to a field or an element, and a
 * widening `:=`.
 *
 * #sec-typed-classes and #sec-weak-references-and-typed-objects state their rules of "an instance of a
 * typed class", with no exception for how it came to exist. So each of these is frozen as a constructed
 * instance is, cannot be held weakly or proxied, and keeps the fields its class declares `readonly`.
 * They were recognised by the list of constructors that had run, which is empty for all of them.
 *
 * Every instance below is handed to the test through a plain object, `{ y }.y`, typed `any`: the
 * checking pass refuses most of these stores where it can see the type, and the subject here is what
 * the run time does when it cannot.
 */

const CLASSES = 'class A { a: uint8; } class B { p: A; q: [2].<uint8>; n: uint8; readonly k: uint8 = 3; } ';
const TRY = "let out = ''; const at = (f) => { try { f(); out += 'ok,'; } catch (e) { out += e.name + ','; } }; ";

/** Each way an instance comes to exist, leaving it in `x`, typed `any`. */
const BUILT: Record<string, string> = {
  'new': 'const y = new B(); const x: any = { y }.y;',
  'a default binding': 'let y: B; const x: any = { y }.y;',
  'a default field': 'class H { b: B; } const h = new H(); const x: any = { h }.h.b;',
  'a default element': 'const xs: [2].<B>; const x: any = { xs }.xs[0];',
  'a parameter': 'let x: any; (function (y: B) { x = { y }; })(new B()); x = x.y;',
  'a typed binding': 'const src = new B(); let y: B = src; const x: any = { y }.y;',
  'a return': 'function mk(): B { const b = new B(); return b; } const y = mk(); const x: any = { y }.y;',
  'a stored field': 'class H { b: B; } const h = new H(); h.b = new B(); const x: any = { h }.h.b;',
  'a stored element': 'const xs: [].<B> = [new B()]; const x: any = { xs }.xs[0];',
};

test.each(Object.entries(BUILT))('an instance from %s is frozen as one from `new` is', (_name, make) => {
  // #sec-typed-classes: "A subsequent assignment to any field is therefore a *TypeError* in every
  // mode", and "a field of a frozen instance whose value is of a value type is read-only in every part
  // of that value... so a frozen value does not change".
  const result = evaluated(`${CLASSES}${TRY}${make} Object.freeze(x); out += String(Object.isFrozen(x)) + ','; `
    + 'at(() => { x.n = 4; }); at(() => { x.p.a = 4; }); at(() => { x.q[0] = 4; }); at(() => { x.k = 4; }); '
    + 'out + String(x.n) + String(x.p.a) + String(x.q[0]);');
  expect(result).toBe('true,TypeError,TypeError,TypeError,TypeError,000');
});

test.each(Object.entries(BUILT))('an instance from %s cannot be held weakly or proxied', (_name, make) => {
  // #sec-weak-references-and-typed-objects: a value has no identity for a weak reference to observe.
  // #sec-reflection-and-declared-types: a field access does not consult a handler.
  const result = evaluated(`${CLASSES}${TRY}${make} at(() => { new WeakRef(x); }); at(() => { new WeakMap().set(x, 1); }); `
    + 'at(() => { new WeakSet().add(x); }); at(() => { new Proxy(x, {}); }); out;');
  expect(result).toBe('TypeError,TypeError,TypeError,TypeError,');
});

test.each(Object.entries(BUILT))('an instance from %s keeps the fields its class declares readonly', (_name, make) => {
  // #sec-typed-classes: "Every other assignment is a type error... through reflection is a *TypeError*."
  // A default never ran the initializer, so the field holds its zero, and it is `readonly` there too.
  const result = evaluated(`${CLASSES}${TRY}${make} const before = String(x.k); at(() => { x.k = 9; }); at(() => { Reflect.set(x, 'k', 9); }); `
    + "at(() => { Object.defineProperty(x, 'k', { value: 9 }); }); at(() => { x.n = 1; }); out + String(String(x.k) === before) + String(x.n);");
  expect(result).toBe('TypeError,TypeError,TypeError,ok,true1');
});

test('a default takes its zero for a readonly field, and a constructed instance its initializer', () => {
  expect(evaluated(`${CLASSES}let d: B; String(d.k) + String(new B().k);`)).toBe('03');
});

test('a readonly field of a default that holds a value is read-only in every part', () => {
  // #sec-readonly-inline-values, for an instance no constructor built.
  const R = 'class A { a: uint8; } class R { readonly p: A; readonly q: [2].<uint8>; } ';
  expect(evaluated(`${R}${TRY}let y: R; const x: any = { y }.y; at(() => { x.p.a = 4; }); at(() => { x.q[0] = 4; }); at(() => { x.q.fill(1); }); out + String(x.p.a) + String(x.q[0]);`))
    .toBe('TypeError,TypeError,TypeError,00');
  // A copy of it is the reader's own.
  expect(evaluated(`${R}let y: R; const c = y.p; c.a = 9; String(c.a) + String(y.p.a);`)).toBe('90');
});

test('a widening, a generic application and a subclass that adds no storage are recognised too', () => {
  const W = 'class A { a: uint8; } class C extends A { c: uint8; } class Q extends A { get twice() { return this.a * 2; } } ';
  // `c := A` is a genuine `A`: it has the base's constructors and not the subclass's.
  expect(evaluated(`${W}${TRY}const y: A = new C() := A; const x: any = { y }.y; at(() => { new WeakRef(x); }); at(() => { new Proxy(x, {}); }); Object.freeze(x); at(() => { x.a = 4; }); out + String(x.a) + String(x instanceof C) + String(x instanceof A);`))
    .toBe('TypeError,TypeError,TypeError,0falsetrue');
  // A copy of a `Q` at a position of `A` is a `Q`.
  expect(evaluated(`${W}${TRY}let x: any; (function (y: A) { x = { y }; })(new Q()); x = x.y; at(() => { new WeakRef(x); }); Object.freeze(x); at(() => { x.a = 4; }); out + String(x.a) + String(x instanceof Q);`))
    .toBe('TypeError,TypeError,0true');
  expect(evaluated(`${TRY}class G<T: type> { v: T; n: uint8; } let y: G.<uint8>; const x: any = { y }.y; at(() => { new WeakRef(x); }); Object.freeze(x); at(() => { x.n = 4; }); out + String(x.n);`))
    .toBe('TypeError,TypeError,0');
});

test('an instance onto storage is recognised too', () => {
  // An element read through a buffer view, and an element of an SoA: each is a value of its class.
  const S = 'class A { a: uint8; b: uint8; } ';
  expect(evaluated(`${S}${TRY}const buf = new ArrayBuffer(8); const v = Span.<A>(buf); const x: any = { e: v[0] }.e; at(() => { new WeakRef(x); }); at(() => { new Proxy(x, {}); }); out + String(x.a);`))
    .toBe('TypeError,TypeError,0');
  expect(evaluated(`${S}${TRY}const s = new SoA.<A>(2); const x: any = { e: s[0] }.e; at(() => { new WeakRef(x); }); at(() => { new Proxy(x, {}); }); out + String(x.a);`))
    .toBe('TypeError,TypeError,0');
  expect(evaluated(`${S}${TRY}const buf = new ArrayBuffer(8); const p = new(buf, 0) A(); const x: any = { p }.p; at(() => { new WeakRef(x); }); at(() => { new Proxy(x, {}); }); out;`))
    .toBe('TypeError,TypeError,');
});

test('a reference class is held by reference, and is still held weakly', () => {
  // The control: none of this reaches a class that has an identity.
  expect(evaluated(`${TRY}reference class R { n: uint8; } const r = new R(); at(() => { new WeakRef(r); }); at(() => { new WeakMap().set(r, 1); }); out;`)).toBe('ok,ok,');
});

test('a copy at a typed boundary of a frozen value is not frozen, and keeps its declared readonly fields', () => {
  // The copy a typed boundary takes agrees with the copy a read takes (classes/readonly-fields.test.mts).
  expect(evaluated(`${CLASSES}${TRY}const src = new B(); Object.freeze(src); let y: B = src; out += String(Object.isFrozen(y)) + ','; `
    + 'at(() => { y.n = 4; }); at(() => { y.p.a = 4; }); at(() => { y.q[0] = 4; }); const u: any = { y }; at(() => { u.y.k = 4; }); '
    + 'out + String(y.n) + String(y.p.a) + String(y.q[0]) + String(y.k) + String(src.n);')).toBe('false,ok,ok,ok,TypeError,44430');
  expect(evaluated(`${CLASSES}${TRY}const src = new B(); Object.freeze(src); function f(y: B) { out += String(Object.isFrozen(y)) + ','; at(() => { y.n = 4; }); at(() => { y.p.a = 4; }); `
    + 'const u: any = { y }; at(() => { u.y.k = 4; }); return String(y.n) + String(y.p.a) + String(y.k); } const r = f(src); out + r + String(src.n);')).toBe('false,ok,ok,TypeError,4430');
});

test('an instance the engine built is equal to one a constructor built, and has the same type', () => {
  // Recording how it was built changes nothing a program reads of the value.
  expect(evaluated('class A { a: uint8; } let d: A; const c = new A(); String(d === c) + String(new Set([d]).has(c)) + String(Reflect.typeOf(d) === Reflect.typeOf(c)) + JSON.stringify(d) + String(Object.isExtensible(d));'))
    .toBe('truetruetrue{"a":0}false');
});
