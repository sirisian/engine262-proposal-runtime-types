import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Freezing a typed array or a tuple (#sec-typed-classes, for an array).
 *
 * An array's elements are its storage, as an instance's fields are. So a frozen typed array or tuple
 * is frozen as an instance of a typed class is: a store to an element is a TypeError in every mode,
 * and an element that is stored inline - a value type class instance, an array of fixed length of a
 * value type, a tuple of value types - is read-only in every part, so that a frozen value does not
 * change. An element of a reference type is a reference, and the object it refers to is as writable
 * as it was. Freezing is an act on one object: a copy is not frozen. An untyped array is frozen as
 * JavaScript freezes it.
 */

const T = "class A { a: uint8; bump() { this.a += 1; } } reference class R { x: uint8; } let out = ''; const at = (f) => { try { f(); out += 'ok,'; } catch (e) { out += e.name + ','; } }; ";

test('an element of a frozen array that is stored inline is read-only in every part', () => {
  // A fixed-length array of a value class: the element, a field of it, and a method that stores to `this`.
  expect(evaluated(`${T}const xs: [2].<A>; Object.freeze(xs); at(() => { xs[0].a = 4; }); at(() => { xs[0] = new A(); }); at(() => { xs[0].bump(); }); out + String(xs[0].a) + String(Object.isFrozen(xs));`))
    .toBe('TypeError,TypeError,TypeError,0true');
  // An array of arrays, and a tuple.
  expect(evaluated(`${T}const g: [2].<[2].<uint8>>; Object.freeze(g); at(() => { g[0][1] = 4; }); at(() => { g[0] = [1, 1]; }); at(() => { g[0].fill(3); }); out + String(g[0][1]) + String(g[0][0]);`))
    .toBe('TypeError,TypeError,TypeError,00');
  expect(evaluated(`${T}const t: [A, uint8] = [new A(), 1]; Object.freeze(t); at(() => { t[0].a = 4; }); at(() => { t[1] = 2; }); out + String(t[0].a) + String(t[1]);`))
    .toBe('TypeError,TypeError,01');
  // A growable array holds its elements in its own storage in the same way.
  expect(evaluated(`${T}const xs: [].<A> = [new A()]; Object.freeze(xs); at(() => { xs[0].a = 4; }); at(() => { xs.push(new A()); }); at(() => { xs.length = 0; }); out + String(xs[0].a) + String(xs.length);`))
    .toBe('TypeError,TypeError,TypeError,01');
});

test('a frozen value is still equal to a copy taken before it was frozen', () => {
  // What the rule is for: nothing reaches the storage of a frozen value.
  expect(evaluated(`${T}const xs: [2].<A>; const before = xs; Object.freeze(xs); at(() => { xs[0].a = 4; }); at(() => { xs[1].bump(); }); out + String(xs === before);`))
    .toBe('TypeError,TypeError,true');
});

test('a store to an element of a frozen typed array is a TypeError outside strict mode too', () => {
  // No annotation at the top level, so this is not strict mode code: JavaScript's frozen array would
  // neither store nor throw here. The array is made in a function, where the annotation is.
  const made = "function make() { const q: [2].<uint8> = [1, 2]; return q; } const o = { q: make() }; Object.freeze(o.q); let r = 'ok'; try { o.q[0] = 4; } catch (e) { r = e.name; } r + String(o.q[0]);";
  expect(evaluated(made)).toBe('TypeError1');
  // A field's array and a field's tuple, frozen on their own.
  expect(evaluated("class B { q: [2].<uint8>; t: [uint8, uint8]; } const b = new B(); Object.freeze(b.q); Object.freeze(b.t); let r = ''; try { b.q[0] = 4; } catch (e) { r += e.name; } try { b.t[1] = 4; } catch (e) { r += e.name; } r + String(b.q[0]) + String(b.t[1]);"))
    .toBe('TypeErrorTypeError00');
});

test('nothing stores to a frozen array through a reference, a window or a method', () => {
  expect(evaluated(`${T}const xs: [2].<A>; Object.freeze(xs); function setA(ref p: A) { p.a = 5; } at(() => { setA(ref xs[0]); }); at(() => { const ref r = xs[0]; r.a = 6; }); at(() => { for (const ref p of xs) { p.a = 7; } }); out + String(xs[0].a);`))
    .toBe('TypeError,TypeError,TypeError,0');
  expect(evaluated(`${T}const xs: [2].<A>; Object.freeze(xs); function f(w: Span.<A>) { w[0].a = 8; } function g(w: Span.<A>) { w[0] = new A(); } at(() => { f(xs); }); at(() => { g(xs); }); out + String(xs[0].a);`))
    .toBe('TypeError,TypeError,0');
  expect(evaluated(`${T}const q: [3].<uint8> = [3, 1, 2]; Object.freeze(q); at(() => { q.sort(); }); at(() => { q.fill(9); }); at(() => { q.reverse(); }); at(() => { q.copyWithin(0, 1); }); out + q.join('');`))
    .toBe('TypeError,TypeError,TypeError,TypeError,312');
});

test('an element of a reference type is a reference, and its object stays writable', () => {
  expect(evaluated(`${T}const rs: [].<R> = [new R()]; Object.freeze(rs); at(() => { rs[0].x = 5; }); at(() => { rs[0] = new R(); }); out + String(rs[0].x);`))
    .toBe('ok,TypeError,5');
  // Position by position in a tuple: the two values are read-only, the reference is not.
  expect(evaluated(`${T}const t: [[2].<uint8>, A, R] = [[1, 2], new A(), new R()]; Object.freeze(t); at(() => { t[0][0] = 9; }); at(() => { t[1].a = 9; }); at(() => { t[2].x = 9; }); out + String(t[0][0]) + String(t[1].a) + String(t[2].x);`))
    .toBe('TypeError,TypeError,ok,109');
});

test('a copy of a frozen array is not frozen', () => {
  expect(evaluated(`${T}const xs: [2].<A>; Object.freeze(xs); const c = xs; at(() => { c[0].a = 4; }); at(() => { c[1] = new A(); }); out + String(c[0].a) + String(Object.isFrozen(c)) + String(xs[0].a);`))
    .toBe('ok,ok,4false0');
  // The copies the copying methods and a typed spread make.
  expect(evaluated(`${T}const xs: [2].<A>; Object.freeze(xs); const s = xs.toSorted((x: A, y: A) => 0); at(() => { s[0].a = 5; }); const w = xs.with(0, new A()); at(() => { w[1].a = 6; }); const sp: [].<A> = [...xs]; at(() => { sp[0].a = 7; }); out + String(xs[0].a) + String(xs[1].a);`))
    .toBe('ok,ok,ok,00');
  // An element read out into a binding is a copy of it.
  expect(evaluated(`${T}const xs: [2].<A>; Object.freeze(xs); function g(): uint8 { const q = xs[1]; q.a = 3; return q.a; } String(g()) + String(xs[1].a);`)).toBe('30');
  expect(evaluated(`${T}const q: [2].<uint8> = [1, 2]; Object.freeze(q); function f(c: [2].<uint8>) { c[0] = 4; return String(c[0]) + String(Object.isFrozen(c)); } f(q) + String(q[0]);`)).toBe('4false1');
});

test('an untyped holder of an element of a frozen array holds it read-only', () => {
  // A plain array holds a reference to the element it is given, so it is given the read-only one.
  expect(evaluated(`${T}const xs: [2].<A>; Object.freeze(xs); const sp = [...xs]; at(() => { sp[0].a = 7; }); out + String(xs[0].a);`)).toBe('TypeError,0');
});

test('a frozen array reads as it did', () => {
  expect(evaluated(`${T}const xs: [2].<A>; Object.freeze(xs); let n: uint8 = 0; for (const p of xs) n += p.a + 1; JSON.stringify(xs) + String(n) + xs.map((p: A) => p.a).join() + String(xs[0] instanceof A) + Object.keys(xs).join();`))
    .toBe('[{"a":0},{"a":0}]20,0true0,1');
});

test('sealing is not freezing, and an untyped array is frozen as before', () => {
  expect(evaluated(`${T}const xs: [2].<A>; Object.seal(xs); at(() => { xs[0].a = 4; }); at(() => { xs[0] = new A(); }); out + String(xs[0].a);`)).toBe('ok,ok,0');
  // Not strict mode code, and not a typed array: the store to the element fails without a word, and
  // the object the element refers to is written.
  expect(evaluated("let out = ''; const at = (f) => { try { f(); out += 'ok,'; } catch (e) { out += e.name + ','; } }; const q = [{ a: 1 }, 2]; Object.freeze(q); at(() => { q[1] = 4; }); at(() => { q[0].a = 4; }); out + String(q[1]) + String(q[0].a);"))
    .toBe('ok,ok,24');
});
