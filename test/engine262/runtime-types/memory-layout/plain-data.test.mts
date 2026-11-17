import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * `hasLayout` was answering three questions at once - does it STRIDE, is it a
 * VALUE, is it BYTES - and the three are independent. A class of `string` fields
 * is a value type with no layout; a class holding a nullable `dynamic` class
 * field has a layout, a pointer's, and is no value type at all.
 *
 * `isPlainData` is the third answer: laid out, with no reference at any depth, so
 * it may be reinterpreted as bytes. Prior art is C#'s `where T : unmanaged` and
 * Rust's `bytemuck::Pod`, separate from the size question in both.
 */

test('layout and plainness diverge in both directions', () => {
  expect(evaluated(`value class A { x: uint8 = 1; }
    value class S { s: string = ''; }
    dynamic class D { x = 1; }
    class C { d: D | null = null; }
    [A.hasLayout, A.isPlainData,
     S.hasLayout, S.isPlainData,
     C.hasLayout, C.isPlainData].join(',');`)).toBe('true,true,false,false,false,false');
  // A class that holds a reference is not a value class (#sec-value-classes), so it reports no
  // layout either. It did, a pointer's width, while a class was a value or not by its fields. A
  // fixed-length array of references reported one too, its elements' widths, until the table's
  // rows were read through an array as they are through a class (#table-layout-by-type): a
  // reference has no layout to report wherever it is held. So nothing that reports a layout
  // holds a reference, and the two properties now part only where a type has no layout.
  expect(evaluated(`dynamic class D { x = 1; } class R { v: uint8 = 0; }
    [(type [2].<D | null>).hasLayout, (type [2].<D | null>).isPlainData,
     (type [2].<R>).hasLayout, (type [R | null, uint8]).hasLayout].join(',');`)).toBe('false,false,false,false');
  // The inline optional over a value type with a layout has one, as a type and inside an array.
  expect(evaluated(`value class A { x: uint32 = 1; }
    [(type A | null).hasLayout, (type A | null).byteLength, (type uint8 | null).byteLength,
     (type [2].<A | null>).byteLength, (type A | null).isPlainData].join(',');`)).toBe('true,8,2,16,true');
  // ...and over one with none has none.
  expect(evaluated("[(type string | null).hasLayout, (type [2].<string | null>).hasLayout].join(',');")).toBe('false,false');
});

test('plainness descends through fields, arrays, enums and brands', () => {
  expect(evaluated(`value class V { x: float32 = 0; y: float32 = 0; }
    value class Nest { v: V; n: uint8 = 0; }
    value class Arr { a: [4].<V>; }
    class Dyn { a: [].<V> = []; }
    enum E: uint16 { A = 1 }
    value class WithEnum { e: E = E.A; }
    [Nest.isPlainData, Arr.isPlainData, Dyn.isPlainData, WithEnum.isPlainData].join(',');`))
    .toBe('true,true,false,true');
});

test('a scalar is plain and a string, bigint or any is not', () => {
  expect(evaluated(`[uint8.isPlainData, string.isPlainData,
    bigint.isPlainData, any.isPlainData].join(',');`)).toBe('true,false,false,false');
});

test('asking never throws, where asserting still does', () => {
  // The reason hasLayout exists, and it applies to this for the same reason: a
  // serializer walking a heterogeneous structure is asking, not asserting.
  expect(evaluated('String(string.isPlainData);')).toBe('false');
  expectThrown('string.byteLength;', 'has no layout');
});

test('a reference type reports no layout, and neither does a class that holds one', () => {
  // `table-layout-by-type` gives a reference type no layout - "a reference's
  // width is the implementation's business" - so the reported answer and the
  // storage answer are different questions and now different functions.
  expect(evaluated(`class R { x: uint8 = 1; }
    class H { r: R | null = null; }
    R.hasLayout + '/' + H.hasLayout;`)).toBe('false/false');
  expectThrown('class R { x: uint8 = 1; } R.byteLength;', 'has no layout');
});

test('a buffer view refuses a reference-bearing element at construction', () => {
  // Laying such a type over bytes a program controls reads a forged reference
  // back out, and reads a real one the other way. Refused where the view is
  // made, so one that could never be read does not report a length first.
  expectThrown(`dynamic class D { x = 1; }
    class C { d: D | null = null; }
    Span.<C>(new ArrayBuffer(64));`, 'cannot be viewed in a buffer');
});

test('a buffer view still accepts a plain element', () => {
  expect(evaluated(`value class V { x: float32 = 0; y: float32 = 0; }
    String(Span.<V>(new ArrayBuffer(64)).length);`)).toBe('8');
  expect(evaluated('String(Span.<uint8>(new ArrayBuffer(64)).length);')).toBe('64');
});

test('value classes copy and reference classes alias', () => {
  // Guards the five copy sites that used to read value-type-ness off
  // `LayoutOf(t) !== null` and patch the reference case back out by hand; they
  // now ask IsValueTypeClass once.
  expect(evaluated(`value class V { x: uint8 = 1; }
    class R { x: uint8 = 1; }
    const a = new V(); const b = a; b.x = 9;
    const p = new R(); const q = p; q.x = 9;
    a.x + '/' + p.x;`)).toBe('1/9');
});

/**
 * #sec-value-type-copying: "Assigning a value of a value type, passing one as
 * an argument, and returning one each COPY it", the positions including
 * "storing into a field or an array element of that type". A built-in member
 * is no exception. One that returns an element returns a copy, and one that
 * builds an array of the receiver's element type stores, and so copies, each
 * element it takes. They handed out the element objects themselves, so
 * writing to `xs.slice()[0]` wrote `xs`.
 */
test('a built-in member copies a value-type element it returns or stores', () => {
  const A = 'value class A { a: uint8; b: uint8; } const xs: [2].<A>; ';
  const untouched = (taken: string): void => {
    expect(evaluated(`${A}${taken} String(xs[0].a) + String(xs[1].a);`)).toBe('00');
  };
  // Returned.
  untouched('const p = xs.at(0); if (p !== undefined) p.a = 9;');
  untouched('const p = xs.find((e) => true); if (p !== undefined) p.a = 9;');
  untouched('const p = xs.findLast((e) => true); if (p !== undefined) p.a = 9;');
  // Stored into a new array of the element type.
  untouched('const s = xs.slice(); s[0].a = 9; s[1].a = 9;');
  untouched('const s = xs.concat(xs); s[0].a = 9; s[3].a = 9;');
  untouched('const s = xs.filter((e) => true); s[0].a = 9; s[1].a = 9;');
  untouched('const s = xs.toSorted((p, q) => 0); s[0].a = 9; s[1].a = 9;');
  untouched('const s = xs.toReversed(); s[0].a = 9; s[1].a = 9;');
  untouched('const s = xs.toSpliced(0, 0); s[0].a = 9; s[1].a = 9;');
  untouched('const s = xs.with(1, new A()); s[0].a = 9;');
  // Through a window too.
  untouched('const w: Span.<A> = xs; const s = w.slice(); s[0].a = 9; const p = w.at(1); if (p !== undefined) p.a = 9;');
  // The copy is a whole value, and is the caller's own.
  expect(evaluated(`${A}xs[0].a = 3; xs[0].b = 4; const s = xs.slice(); s[0].a = 7; String(s[0].a) + String(s[0].b) + String(xs[0].a);`)).toBe('743');
});

test('a plain object or array still holds a reference to an inline element', () => {
  // The same clause: "A plain object's property and a plain array's element
  // ... hold a REFERENCE ... and a program that wants a copy into one writes a
  // conversion."
  const A = 'value class A { a: uint8; } const xs: [2].<A>; ';
  expect(evaluated(`${A}const o = { e: xs[0] }; o.e.a = 9; String(xs[0].a);`)).toBe('9');
  expect(evaluated(`${A}const plain = [xs[0]]; plain[0].a = 9; String(xs[0].a);`)).toBe('9');
  expect(evaluated(`${A}const all = [...xs]; all[1].a = 9; String(xs[1].a);`)).toBe('9');
  // At a typed array's annotation the literal stores, and so copies.
  expect(evaluated(`${A}const c: [].<A> = [...xs]; c[0].a = 9; String(xs[0].a);`)).toBe('0');
});

test('Array.from copies the value-type elements it takes from a typed source', () => {
  // Its result carries the source's element type, so each element is stored
  // into typed storage, and copied (#sec-value-type-copying). It shared them.
  const A = 'value class A { a: uint8; } const xs: [2].<A>; ';
  expect(evaluated(`${A}const c: [].<A> = Array.from(xs); c[0].a = 9; c[1].a = 9; String(xs[0].a) + String(xs[1].a) + String(c.length);`)).toBe('002');
  expect(evaluated(`${A}const w: Span.<A> = xs; const c: [].<A> = Array.from(w); c[0].a = 9; String(xs[0].a);`)).toBe('0');
  // A mapping decides its own elements, and an array of numbers is as before.
  expect(evaluated(`${A}xs[1].a = 4; const c = Array.from(xs, (e) => e.a); String(c.length) + String(c[1]);`)).toBe('24');
  expect(evaluated('const a: [].<uint8> = [1, 2]; const c: [].<uint8> = Array.from(a); c.push(3 := uint8); String(c.length) + String(a.length);')).toBe('32');
});

test('a Map with a declared value type returns a copy of a value it stores', () => {
  // #sec-value-type-copying: "returning one" copies, and a built-in member is
  // "a case of this and not an exception to it". `set` already stored a copy;
  // `get` handed out the stored value itself, so a store through its result
  // wrote the Map.
  const P = 'value class P { x: uint8; } ';
  const read = "const k = m.get('k'); String(k !== undefined ? k.x : -1);";
  expect(evaluated(`${P}const m = new Map.<string, P>(); const p = new P(); m.set('k', p); p.x = 5; const g = m.get('k'); if (g !== undefined) g.x = 9; ${read}`)).toBe('0');
  expect(evaluated(`${P}const m = new Map.<string, P>(); const a = m.getOrInsert('k', new P()); a.x = 9; const c = m.getOrInsert('k', new P()); c.x = 7; ${read}`)).toBe('0');
  expect(evaluated(`${P}const m = new Map.<string, P>(); const b = m.getOrInsertComputed('k', () => new P()); b.x = 8; ${read}`)).toBe('0');
  // A fixed-length array and a tuple of value types are values too.
  expect(evaluated("const m = new Map.<string, [uint8, uint8]>(); const t: [uint8, uint8] = [1, 2]; m.set('k', t); t[0] = 5; const g = m.get('k'); if (g !== undefined) g[1] = 9; "
    + "const again = m.get('k'); String(again !== undefined ? again[0] : -1) + String(again !== undefined ? again[1] : -1);")).toBe('12');
  // A reference class is stored by reference, and an untyped Map is a plain
  // holder whose value is a reference, as a plain object's property is.
  expect(evaluated("class R { x: uint8; } const m = new Map.<string, R>(); const r = new R(); m.set('k', r); const g = m.get('k'); if (g !== undefined) g.x = 9; String(r.x);")).toBe('9');
  // A store through the call writes the value the holder refers to; a binding
  // from the call copies it, as a binding from `o.k` does.
  expect(evaluated(`${P}const m = new Map(); const p = new P(); m.set('k', p); m.get('k').x = 9; String(p.x);`)).toBe('9');
  expect(evaluated(`${P}const m = new Map(); const p = new P(); m.set('k', p); const g: any = m.get('k'); g.x = 9; String(p.x);`)).toBe('0');
});
