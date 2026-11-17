import { test, expect } from 'vitest';
import {
  evaluated, expectThrown, expectStaticTypeError, observeScript,
} from '../harness.mts';

/**
 * A value type class with no layout (#sec-typed-classes, "A LAYOUT IS NOT PART OF THE CONDITION").
 *
 * "A typed class is a value type class when every one of its fields has a type that is a value type."
 * A `string`, a `bigint`, a symbol, a literal type and a union of value types are value types whose size
 * belongs to the value, so they have no layout, and a class holding one has none either
 * (#table-layout-by-type). It is a value type class all the same. #sec-layout-properties names the rule:
 * "an array stride needs a layout, an assignment needs value-ness, and a byte view needs plain data".
 *
 * The engine asked for a layout before it copied a class. So `value class K { n: uint8; s: string; }` was one
 * object under every name and was never `===` to another, while `[string, uint8]` and `[2].<string>` were
 * copied and compared by their elements, and `Box.<uint8>` was a value where `Box.<string>` was not.
 */

/** Stores through a second name, a typed binding, a parameter, a field and an element; `C` where the original is unchanged. */
const POSITIONS = `function pos(): string {
  let r = '';
  { const a = new K(); const b = a; b.n = 5; r += (a.n === b.n ? 'S' : 'C'); }
  { const a = new K(); const t: K = a; t.n = 6; r += (a.n === t.n ? 'S' : 'C'); }
  { const a = new K(); const g = (p: K): K => { p.n = 7; return p; }; const q = g(a); r += (a.n === q.n ? 'S' : 'C'); }
  { const a = new K(); const h = new H(a); h.k.n = 8; r += (a.n === h.k.n ? 'S' : 'C'); }
  { const a = new K(); const xs: [].<K> = [a]; xs[0].n = 9; r += (a.n === xs[0].n ? 'S' : 'C'); }
  return r;
}
class H { k: K = new K(); constructor(k: K) { this.k = k; } }
function f() {
  const x = new K(); const y = new K(); const u: any = { x, y };
  return [pos(), String(u.x === u.y), String(new Set([x]).has(y)), String(K.hasLayout), String(Reflect.isAssignable(K, value))].join(' ');
} f();`;

const VALUE_FIELDS: Record<string, string> = {
  'a string': 'value class K { n: uint8; s: string; }',
  'a bigint': 'value class K { n: uint8; s: bigint; }',
  'a symbol': 'value class K { n: uint8; s: symbol = Symbol.iterator; }',
  'a literal type': 'value class K { n: uint8; s: "a"; }',
  'a union of literals': 'value class K { n: uint8; s: "a" | "b" = "a"; }',
  'a string enum': 'enum E: string { A = "a", B = "b" } value class K { n: uint8; s: E = E.A; }',
  'a union of two integer types': 'value class K { n: uint8; s: uint8 | uint16 = 1; }',
  'a number or a string': 'value class K { n: uint8; s: number | string = 1; }',
  'a nullable string': 'value class K { n: uint8; s: string | null = null; }',
  'a string or undefined': 'value class K { n: uint8; s: string | undefined = undefined; }',
  'a nullable bigint': 'value class K { n: uint8; s: bigint | null = null; }',
  'a string with metadata': "value class K { n: uint8; s: string.<{ pattern: /^a/ }> = 'a'; }",
  'a rational of bigints': 'value class K { n: uint8; s: rational.<bigint>; }',
  'a private string': "value class K { n: uint8; #s: string = 'x'; }",
  'a tuple holding a string': 'value class K { n: uint8; s: [string, uint8]; }',
  'a fixed array of strings': 'value class K { n: uint8; s: [2].<string>; }',
  'a class holding a string': 'value class P { name: string; } value class K { n: uint8; s: P; }',
};

test.each(Object.entries(VALUE_FIELDS))('a class with a field that is %s is copied at every position and compared by its fields', (_name, declaration) => {
  // Copied at all five positions; two fresh ones are `===` and one member of a Set; no layout; a value type.
  expect(evaluated(`${declaration} ${POSITIONS}`)).toBe('CCCCC true true false true');
});

test('a class every field of which has a layout is as before', () => {
  expect(evaluated(`value class K { n: uint8; } ${POSITIONS}`)).toBe('CCCCC true true true true');
  expect(evaluated(`value class K { n: uint8; s: uint8 | null; } ${POSITIONS}`)).toBe('CCCCC true true true true');
  expect(evaluated(`value class K { n: uint8; s: decimal64; } ${POSITIONS}`)).toBe('CCCCC true true true true');
});

test('a class with a field of a reference type is held by reference, as before', () => {
  expect(evaluated(`class K { n: uint8; s: object = {}; } ${POSITIONS}`)).toBe('SSSSS false false false false');
  expect(evaluated(`class K { n: uint8; s: [].<uint8> = []; } ${POSITIONS}`)).toBe('SSSSS false false false false');
  expect(evaluated(`class K { n: uint8; s: () => void = () => {}; } ${POSITIONS}`)).toBe('SSSSS false false false false');
  expect(evaluated(`class K { n: uint8; s: any; } ${POSITIONS}`)).toBe('SSSSS false false false false');
  expect(evaluated(`class R { x: uint8; } class K { n: uint8; s: R = new R(); } ${POSITIONS}`)).toBe('SSSSS false false false false');
  // And a class declared `reference` is one whatever it holds.
  expect(evaluated('class K { n: uint8; s: string; } function f() { const a = new K(); const b = a; b.n = 5; return String(a.n); } f();')).toBe('5');
});

test('the copy is field by field, and a string field is its own in each copy', () => {
  const P = "value class P { name: string; age: uint8; } ";
  expect(evaluated(`${P}function f() { const a = new P(); a.name = 'Ada'; a.age = 36; let b = a; b.name = 'Grace'; b.age = 85; return a.name + String(a.age) + b.name + String(b.age); } f();`))
    .toBe('Ada36Grace85');
  // The value is compared by its fields: a string field by its content.
  expect(evaluated(`${P}function f() { const a = new P(); a.name = 'A' + 'da'; const b = new P(); b.name = 'Ad' + 'a'; const u: any = { a, b }; const same = u.a === u.b; b.name = 'Bob'; return String(same) + String(u.a === u.b) + String(Object.is(u.a, u.a)); } f();`))
    .toBe('truefalsetrue');
  // One key of a Map, and found by `includes` and `indexOf`.
  expect(evaluated(`${P}function f() { const a = new P(); a.name = 'Ada'; const b = new P(); b.name = 'Ada'; const m = new Map(); m.set(a, 1); const xs: [].<P> = [a]; return String(m.get(b)) + String(xs.includes(b)) + String(xs.indexOf(b)) + String(new Set([a, b]).size); } f();`))
    .toBe('1true01');
  // A key is copied when it is inserted, so a change to the original afterwards does not move it.
  expect(evaluated(`${P}function f() { const a = new P(); a.name = 'Ada'; const m = new Map.<P, uint8>(); m.set(a, 1); a.name = 'Bob'; const k = new P(); k.name = 'Ada'; return String(m.get(k)) + String(m.get(a)); } f();`))
    .toBe('1undefined');
});

test('a class, a tuple and a fixed array of the same contents agree', () => {
  expect(evaluated("value class K { s: string; n: uint8; } function f() { const t: [string, uint8] = ['x', 1]; const t2 = t; t2[0] = 'z'; const q: [2].<string> = ['x', 'y']; const q2 = q; q2[0] = 'z'; const k = new K(); k.s = 'x'; const k2 = k; k2.s = 'z'; return t[0] + t2[0] + q[0] + q2[0] + k.s + k2.s; } f();"))
    .toBe('xzxzxz');
  // The class is not shared around an array that is copied.
  expect(evaluated("value class K { s: [2].<string> = ['x', 'y']; } function f() { const k = new K(); const t = k.s; t[0] = 'z'; const k2 = k; k2.s[1] = 'w'; return k.s.join('') + t.join('') + k2.s.join(''); } f();"))
    .toBe('xyzyxw');
});

test('a generic class is one kind of class at every argument', () => {
  const BOX = 'value class Box<T: type extends value> { v: T; n: uint8; } ';
  expect(evaluated(`${BOX}function f() { const a = new Box.<string>(); const b = a; b.n = 5; const c = new Box.<uint8>(); const d = c; d.n = 5; return String(a.n) + String(b.n) + String(c.n) + String(d.n); } f();`)).toBe('0505');
  expect(evaluated(`${BOX}function f() { const x = new Box.<string>(); const y = new Box.<string>(); const u: any = { x, y }; return String(u.x === u.y) + String((type Box.<string>).hasLayout) + String((type Box.<uint8>).hasLayout); } f();`)).toBe('truefalsetrue');
  // One function over `Box.<T>` leaves its caller's box alone at every `T`.
  expect(evaluated(`${BOX}function bump<T: type extends value>(b: Box.<T>): uint8 { b.n = 9; return b.n; } function f() { const a = new Box.<uint8>(); const s = new Box.<string>(); return String(bump(a)) + String(a.n) + String(bump(s)) + String(s.n); } f();`))
    .toBe('9090');
});

test('it has no layout, and what needs one refuses it', () => {
  const K = 'value class K { n: uint8; s: string; } ';
  expect(evaluated(`${K}String(K.hasLayout) + String(K.isPlainData);`)).toBe('falsefalse');
  expectThrown(`${K}K.byteLength;`, 'has no layout');
  expectThrown(`${K}Span.<K>(new ArrayBuffer(16));`, 'a view needs an element type with a layout');
  expectStaticTypeError(`${K}new SoA.<K>(2);`);
  // `value` admits it and `plain` does not.
  expect(evaluated(`${K}class V<T: type extends value> { xs: [].<T> = []; } new V.<K>(); 'ok';`)).toBe('ok');
  expectStaticTypeError(`${K}class Pl<T: type extends plain> { xs: [].<T> = []; } new Pl.<K>();`);
  // A nullable string has no layout either, as #table-layout-by-type says of a union of value types.
  expect(evaluated('value class K { n: uint8; s: string | null = null; } String(K.hasLayout);')).toBe('false');
  expectThrown('value class K { n: uint8; s: string | null = null; } K.byteLength;', 'has no layout');
  // The inline optional over a type that has a layout is unchanged.
  expect(evaluated('value class K { n: uint8; s: uint32 | null; } String(K.byteLength);')).toBe('12');
});

test('arrays of it hold values, each its own', () => {
  const K = 'value class K { n: uint8; s: string; } ';
  expect(evaluated(`${K}function f() { const xs: [2].<K>; xs[0].n = 7; xs[0].s = 'a'; return String(xs[0].n) + xs[0].s + String(xs[1].n) + '[' + xs[1].s + ']'; } f();`)).toBe('7a0[]');
  // An element read into a name is a copy; the array bound to a second name is a copy.
  expect(evaluated(`${K}function f() { const xs: [2].<K>; const e = xs[0]; e.n = 5; const ys = xs; ys[1].n = 6; return String(e.n) + String(xs[0].n) + String(xs[1].n) + String(ys[1].n); } f();`)).toBe('5006');
  expect(evaluated(`${K}function f() { const xs: [].<K> = [new K()]; for (const ref k of xs) { k.s = 'z'; } return xs[0].s; } f();`)).toBe('z');
  // Two arrays of equal elements are equal.
  expect(evaluated(`${K}function f() { const xs: [2].<K>; const ys: [2].<K>; const u: any = { xs, ys }; return String(u.xs === u.ys); } f();`)).toBe('true');
});

test('it has a default, is frozen and sealed as a value, and cannot be held weakly', () => {
  const K = 'value class K { n: uint8; s: string; } ';
  const TRY = "let out = ''; const at = (g) => { try { g(); out += 'ok,'; } catch (e) { out += e.name + ','; } }; ";
  expect(evaluated(`${K}let k: K; String(k.n) + '[' + k.s + ']' + String(Object.isExtensible(k));`)).toBe('0[]false');
  expect(evaluated(`${K}${TRY}const y = new K(); const x: any = { y }.y; at(() => { new WeakRef(x); }); at(() => { new WeakMap().set(x, 1); }); at(() => { new Proxy(x, {}); }); out;`))
    .toBe('TypeError,TypeError,TypeError,');
  // A copy of a frozen value is not frozen.
  expect(evaluated(`${K}function f() { const a = new K(); Object.freeze(a); const b = a; b.s = 'z'; return b.s + '[' + a.s + ']' + String(Object.isFrozen(b)) + String(Object.isFrozen(a)); } f();`)).toBe('z[]falsetrue');
  // A frozen holder's member, and a `readonly` member, are read-only in every part.
  expect(evaluated(`${K}${TRY}value class H { k: K = new K(); } const h = new H(); Object.freeze(h); const u: any = { h }; at(() => { u.h.k.n = 5; }); at(() => { u.h.k.s = 'z'; }); out + String(h.k.n);`))
    .toBe('TypeError,TypeError,0');
  expect(evaluated(`${K}${TRY}value class H { readonly k: K = new K(); } const h = new H(); const u: any = { h }; at(() => { u.h.k.s = 'z'; }); out + '[' + h.k.s + ']';`)).toBe('TypeError,[]');
});

test('the checking pass judges it as it judges a class of numbers', () => {
  const K = 'value class K { n: uint8; s: string; } ';
  const lost = { bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-store-to-copy' } };
  // #sec-store-to-a-copy: a parameter, a `for`-`of` head and a second name each hold a copy.
  expect(observeScript(`${K}function f(k: K) { k.s = 'z'; } f(new K());`)).toMatchObject(lost);
  expect(observeScript(`${K}function f() { const xs: [].<K> = [new K()]; for (const k of xs) { k.n = 5; } } f();`)).toMatchObject(lost);
  expect(observeScript(`${K}function f() { const a = new K(); const b: K = a; b.n = 5; } f();`)).toMatchObject(lost);
  expect(observeScript("value class K { n: uint8; s: string | null = null; } function f(k: K) { k.n = 5; } f(new K());")).toMatchObject(lost);
  expect(observeScript('value class K { n: uint8; s: "a" | "b" = "a"; } function f(k: K) { k.n = 5; } f(new K());')).toMatchObject(lost);
  // An array and a tuple of strings are judged too: they were copied and not judged.
  expect(observeScript("function f(c: [2].<string>) { c[0] = 'z'; } const a: [2].<string> = ['x', 'y']; f(a);")).toMatchObject(lost);
  expect(observeScript("function f(c: [string, uint8]) { c[1] = 2; } const a: [string, uint8] = ['x', 1]; f(a);")).toMatchObject(lost);
  // #sec-readonly-inline-values.
  expect(observeScript(`${K}value class H { readonly k: K = new K(); } function f() { const h = new H(); h.k.n = 5; } f();`))
    .toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-readonly-store' } });
  // What its writer meant has a spelling, as for a class of numbers.
  expect(evaluated(`${K}function rename(ref k: K) { k.s = 'z'; } function f() { const a = new K(); rename(ref a); return a.s; } f();`)).toBe('z');
  expect(evaluated(`${K}function f() { const xs: [].<K> = [new K()]; xs[0].s = 'z'; return xs[0].s; } f();`)).toBe('z');
  // A read after the store is a use of the copy, and is not judged.
  expect(evaluated(`${K}function f(k: K): string { k.s = 'z'; return k.s; } const a = new K(); f(a) + '[' + a.s + ']';`)).toBe('z[]');
});

test('a subclass follows its base', () => {
  const SB = "value class B { x: uint8 = 7; s: string = 'ok'; } value class S extends B { y: uint8 = 1; } value class E extends B { } ";
  // A copy carries the base's fields and the subclass's.
  expect(evaluated(`${SB}function f() { const b = new S(); const c = b; c.x = 9; c.y = 2; return String(b.x) + b.s + String(b.y) + String(c.x) + c.s + String(c.y); } f();`)).toBe('7ok19ok2');
  expect(evaluated(`${SB}function f() { const a = new E(); const b = new E(); const u: any = { a, b }; return String(u.a === u.b) + String(E.hasLayout); } f();`)).toBe('truefalse');
  // A subclass that declares storage is refused at a position of its base; one that declares none is held there.
  expectThrown(`${SB}function g(b: B): uint8 { return b.x; } const u: any = new S(); g(u);`, 'is not assignable to');
  expect(evaluated(`${SB}function g(b: B): string { return b.s + String(b instanceof E); } g(new E());`)).toBe('oktrue');
});
