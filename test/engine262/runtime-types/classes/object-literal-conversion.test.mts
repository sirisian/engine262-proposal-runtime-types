import { test, expect } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * An object literal converted to a class (#sec-object-literal-conversion).
 *
 * The README writes `return { position: 0, op, left, right } := BinaryNode;` and says the literal
 * "fills the class's layout directly", and the design's operators return their results that way:
 * `return { v: this.v + rhs.v } := Vector4;`. The specification said the opposite - "an object
 * literal does not convert to a class structurally" - and the engine followed it, so every one of
 * those was a TypeError when it ran: `[object Object] is not assignable to "Vector4"`.
 *
 * The literal now fills a class that has nothing construction would go around: no class of its
 * chain declares a constructor, or a field a literal cannot name - a private, a protected or an
 * `accessor` one. That is C++'s aggregate initialization, and the visibility rule Rust gives a
 * struct literal. A class held by reference that declares a constructor says how it is made, and a
 * literal does not bypass it: it converts only by a conversion the class declares, as before.
 *
 * A value class is filled whether or not it declares a constructor. Its default, its copies and
 * the elements of an array of it are made without one, so its constructor is not what every
 * instance was made by; the literal fills it as C# fills a struct's settable fields beside its
 * constructors, running none, and names no `readonly` field, which is the constructor's to write.
 * The design's `Vector4` declares `constructor(x, y, z, w)` and returns `{ v: ... } := Vector4`
 * from its operators.
 */

const early = (rule: string) => ({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
const V = 'class V { x: uint8 = 0; y: uint8 = 0; } ';

test('an object literal fills a class that declares no constructor', () => {
  expect(evaluated(`${V}const v = { x: 1, y: 2 } := V; String(v.x) + String(v.y) + String(v instanceof V);`)).toBe('12true');
  expect(evaluated('value class P { x: float32; y: float32; } const p = { x: 1.5, y: 2 } := P; String(p.x) + "," + String(p.y);')).toBe('1.5,2');
  // Through a chain of classes, each with no constructor.
  expect(evaluated('class A { x: uint8 = 1; } class B extends A { y: uint8 = 2; } const b = { x: 7, y: 8 } := B; String(b.x) + String(b.y) + String(b instanceof A);'))
    .toBe('78true');
  // A shorthand property names its field too, and an untyped class is filled as a typed one is.
  expect(evaluated(`${V}const x: uint8 = 3, y: uint8 = 4; const v = { x, y } := V; String(v.x) + String(v.y);`)).toBe('34');
  expect(evaluated('class U { a = 1; b = 2; } const u = { a: 5 } := U; String(u.a) + String(u.b) + String(u instanceof U);')).toBe('52true');
  // A specialization of a generic class, and a type parameter bound to a class when it runs.
  expect(evaluated('class Box<T: type> { v: T | null = null; } const b = { v: 5 } := Box.<uint8>; String(b.v);')).toBe('5');
  expect(evaluated('class G { x: uint8 = 0; } function mk<T: type>(): T { return { x: 1 } := T; } String(mk.<G>().x);')).toBe('1');
  // The forms the design writes: a node built in a return, an operator returning its own class.
  expect(evaluated('enum TokenType: uint8 { Plus, Minus } sealed class Node { position: uint32 = 0; } class NumberNode extends Node { value: float64 = 0; } '
    + 'class BinaryNode extends Node { op: TokenType = TokenType.Plus; left: Node | null = null; right: Node | null = null; } '
    + 'function make(op: TokenType, left: Node, right: Node): BinaryNode { return { position: 0, op, left, right } := BinaryNode; } '
    + 'const n = { position: 1, value: 2 } := NumberNode; const b = make(TokenType.Minus, n, n); String(b.op === TokenType.Minus) + String(b.left instanceof NumberNode);'))
    .toBe('truetrue');
  expect(evaluated('value class Vector2 { x: float32; y: float32; operator+(o: Vector2): Vector2 { return { x: this.x + o.x, y: this.y + o.y } := Vector2; } } '
    + 'const a = { x: 1, y: 2 } := Vector2; const s = a + a; String(s.x) + "," + String(s.y);')).toBe('2,4');
  // The instance takes no new property, as one `new` makes takes none.
  expect(evaluated(`${V}const v = { x: 1 } := V; String(Object.isExtensible(v)) + String(Object.isExtensible(new V()));`)).toBe('falsefalse');
});

test('a field the literal names is not initialized; the rest are, as new initializes them', () => {
  expect(evaluated('class V { x: uint8 = 7; y: uint8 = 9; } const v = { x: 1 } := V; String(v.x) + String(v.y);')).toBe('19');
  // The initializer of a named field does not run, and the others run in order, so a later one
  // reads the value the literal gave an earlier field.
  expect(evaluated('let n = 0; class V { x: uint8 = (n += 1, 5); y: uint8 = (n += 10, 6); } const v = { x: 1 } := V; String(v.x) + String(v.y) + "," + String(n);'))
    .toBe('16,10');
  expect(evaluated('class V { x: uint8 = 1; y: uint8 = this.x + 1; } const v = { x: 5 } := V; String(v.y);')).toBe('6');
  // A typed field with no initializer takes its type's default.
  expect(evaluated('value class P { x: float32; y: float32; } const p = { y: 3 } := P; String(p.x) + "," + String(p.y);')).toBe('0,3');
  // An empty literal is `new`.
  expect(evaluated('class V { x: uint8 = 7; } const v = {} := V; String(v.x);')).toBe('7');
});

test('each value converts to its field\'s type, as a member of a structural target does', () => {
  // `:=` converts: a constant wraps as `300 := uint8` does, and a number held in a `let` converts.
  expect(evaluated(`${V}const v = { x: 300, y: 200 + 100 } := V; String(v.x) + "," + String(v.y);`)).toBe('44,44');
  expect(evaluated(`${V}let m = 6; const v = { x: m } := V; String(v.x);`)).toBe('6');
  // A literal is read at the field's type from its digits.
  expect(evaluated('class Item { price: decimal64 = 0; } const i = { price: 0.1 } := Item; String(i.price);')).toBe('0.1');
  expect(evaluated('class W { n: uint64 = 0; } const w = { n: 9007199254740993 } := W; String(w.n);')).toBe('9007199254740993');
  // A string has no conversion to a number, here as anywhere.
  expect(observeScript(`${V}const v = { x: "a" } := V;`)).toMatchObject(early('rt-explicit-conversion'));
  expectThrown(`${V}const v = { x: "a" } := V;`, 'a string is not a conversion source');
});

test('a nested object literal fills the class of its field', () => {
  const P = 'class Vec { x: float32 = 0; y: float32 = 0; } class Part { pos: Vec = new Vec(); m: float32 = 1; } ';
  expect(evaluated(`${P}const p = { pos: { x: 1, y: 2 }, m: 3 } := Part; String(p.pos.x) + String(p.pos.y) + String(p.pos instanceof Vec) + String(p.m);`))
    .toBe('12true3');
  expect(observeScript(`${P}const p = { pos: { x: 1, q: 2 } } := Part;`)).toMatchObject(early('rt-explicit-conversion'));
  expectThrown(`${P}const p = { pos: { x: 1, q: 2 } } := Part;`, '"Vec" has no field named "q"');
});

test('a class held by reference that declares a constructor is made by it, or by a conversion it declares', () => {
  expect(observeScript('class C { x: uint8 = 0; constructor() { } } const c = { x: 1 } := C;')).toMatchObject(early('rt-explicit-conversion'));
  expectThrown('class C { x: uint8 = 0; constructor() { } } const c = { x: 1 } := C;', 'declares a constructor');
  // A constructor anywhere in the chain is the class's construction.
  expect(observeScript('class A { x: uint8 = 1; constructor() { } } class B extends A { y: uint8 = 2; } const b = { y: 8 } := B;'))
    .toMatchObject(early('rt-explicit-conversion'));
  // And where the checker cannot see the class, the conversion refuses when it runs.
  expectThrown('class C { x: uint8 = 0; constructor() { } } function mk<T: type>(): T { return { x: 1 } := T; } mk.<C>();',
    'an object literal converts to "C" only by a conversion it declares, since "C" declares a constructor');
  // A conversion the class declares is the conversion, whether a constructor of one parameter or
  // an inbound operator, and it runs in place of a fill.
  expect(evaluated('class E { x: uint8 = 0; constructor(o: { x: uint8 }) { this.x = o.x + 1; } } const e = { x: 6 } := E; String(e.x);')).toBe('7');
  expect(evaluated('class D { x: uint8 = 0; operator D(o: { x: uint8 }) { const d = new D(); d.x = o.x + 1; return d; } } const d = { x: 5 } := D; String(d.x);')).toBe('6');
  // One that takes a string does not take a literal, so the literal fills (examples/color.md).
  expect(evaluated('value class Color { r: uint8; g: uint8; b: uint8; a: uint8; operator Color(hex: string) { return { r: 1, g: 2, b: 3, a: 4 } := Color; } } '
    + 'function rgb(r: uint8, g: uint8, b: uint8): Color { return { r, g, b, a: 255 } := Color; } String(rgb(1, 2, 3).a) + "," + String(("#fff" := Color).r);'))
    .toBe('255,1');
  // An abstract class is not made at all.
  expect(observeScript('abstract class Q { x: uint8 = 0; } const q = { x: 1 } := Q;')).toMatchObject(early('rt-abstract-construction'));
  // A constructor of one parameter of a primitive type takes no literal, so it is known before
  // the program runs that none of the class's conversions does.
  expect(observeScript('class C { x: uint8 = 0; constructor(n: uint8) { } } const c = { x: 1 } := C;')).toMatchObject(early('rt-explicit-conversion'));
});

test('a value class is filled whether or not it declares a constructor, which does not run', () => {
  // operatoroverloading.md's Vector4: its operators, and Matrix4's, return a filled Vector4.
  const V4 = 'value class Vector4 { v: float32x4; constructor(x: float32, y: float32, z: float32, w: float32) { this.v = float32x4(x, y, z, w); } '
    + 'get x(): float32 { return this.v.x; } operator+(rhs: Vector4): Vector4 { return { v: this.v + rhs.v } := Vector4; } } ';
  expect(evaluated(`${V4}const a = new Vector4(1, 2, 3, 4); const s = a + a; String(s.x) + "," + String(s.v.w);`)).toBe('2,8');
  expect(evaluated(`${V4}value class Matrix4 { c0: float32x4; operator*(v: Vector4): Vector4 { return { v: this.c0 * v.v } := Vector4; } } `
    + 'const m = { c0: float32x4(2, 2, 2, 2) } := Matrix4; String((m * new Vector4(1, 2, 3, 4)).x);')).toBe('2');
  // No constructor body of the chain runs; every field is initialized as a class with no
  // constructor initializes it.
  expect(evaluated('let n = 0; value class P { x: float32 = 1; y: float32 = 2; constructor(a: float32) { n += 1; this.x = a; } } '
    + 'const p = { x: 5 } := P; String(p.x) + "," + String(p.y) + "," + String(n);')).toBe('5,2,0');
  expect(evaluated('let n = 0; value class A { x: uint8 = 1; constructor() { n += 1; } } value class B extends A { y: uint8 = 2; constructor() { super(); n += 10; } } '
    + 'const b = { x: 7, y: 8 } := B; String(b.x) + String(b.y) + String(b instanceof A) + "," + String(n);')).toBe('78true,0');
  // A constructor of one number is not a conversion from the literal, so the literal fills.
  expect(evaluated('value class M { v: float64 = 0; constructor(v: float64) { this.v = v * 2; } } const m = { v: 5 } := M; String(m.v) + "," + String(new M(5).v);'))
    .toBe('5,10');
  expect(evaluated('value class Box<T: type> { v: T; constructor(v: T) { this.v = v; } } const b = { v: 5 } := Box.<uint8>; String(b.v);')).toBe('5');
  // The instance is the value `new` would make: sealed, copied when bound, equal field by field.
  expect(evaluated('value class P { x: float32 = 0; constructor(a: float32) { this.x = a; } } const p = { x: 1 } := P; const q = p; q.x = 9; '
    + 'String(Object.isExtensible(p)) + String(p.x) + String(p == ({ x: 1 } := P));')).toBe('false1true');
  // And the annotation says how to write the conversion.
  expectThrown('value class P { x: float32 = 0; constructor(a: float32) { this.x = a; } } const p: P = { x: 1 };', 'write "{ ... } := P"');
});

test('a value class filled without its constructor is given only what any code may write', () => {
  // A readonly field is written by the constructor, which the fill does not run.
  const P = 'value class P { readonly v: float32 = 0; w: float32 = 0; constructor(v: float32) { if (v > 100) throw new RangeError("v"); this.v = v; } } ';
  expect(observeScript(`${P}const p = { v: 200 } := P;`)).toMatchObject(early('rt-explicit-conversion'));
  expectThrown(`${P}const p = { v: 200 } := P;`, 'that constructor is what writes its readonly field "v"; construct it with new');
  expectThrown(`${P}function mk<T: type>(): T { return { v: 200 } := T; } mk.<P>();`, 'is what writes its readonly field "v"');
  // Omitted, it holds its initializer, and stays readonly.
  expect(evaluated(`${P}const p = { w: 2 } := P; String(p.v) + "," + String(p.w);`)).toBe('0,2');
  expect(observeScript(`${P}const p = { w: 2 } := P; p.v = 4;`)).toMatchObject(early('rt-readonly-store'));
  // A class with no constructor has nothing else to write it, so its literal does, and so does a
  // class of a chain whose constructor is another class's: that constructor cannot write it.
  expect(evaluated('class K { readonly k: uint8 = 3; } const k = { k: 9 } := K; String(k.k);')).toBe('9');
  expect(evaluated('value class A { x: uint8 = 0; constructor() { } } value class B extends A { readonly r: uint8 = 0; } const b = { x: 1, r: 5 } := B; String(b.x) + String(b.r);'))
    .toBe('15');
  expectThrown('value class A { readonly x: uint8 = 0; constructor() { } } value class B extends A { r: uint8 = 0; } const b = { x: 1 } := B;', 'the constructor "A" declares');
  // A field whose type has no default and which has no initializer only the constructor assigned.
  const S = 'value class S { s: symbol; q: float32 = 0; constructor() { this.s = Symbol(); } } ';
  expect(observeScript(`${S}const a = { q: 2 } := S;`)).toMatchObject(early('rt-missing-default'));
  expect(evaluated(`${S}const a = { s: Symbol("k"), q: 2 } := S; String(a.s.description) + String(a.q);`)).toBe('k2');
  // Where the checker cannot tell that the type has no default, the fill refuses when it runs.
  const U = 'value class U { u: uint8 | string; q: float32 = 0; constructor() { this.u = 1; } } ';
  expectThrown(`${U}const a = { q: 2 } := U;`, 'does not name "u", whose type has no default');
  expectThrown(`${U}function mk<T: type>(): T { return { q: 2 } := T; } mk.<U>();`, 'does not name "u", whose type has no default');
  expect(evaluated(`${U}const a = { u: "s", q: 2 } := U; String(a.u) + String(a.q);`)).toBe('s2');
  // A private field still keeps a literal out.
  expect(observeScript('value class P { #s: uint8 = 0; x: uint8 = 0; constructor() { } } const p = { x: 1 } := P;')).toMatchObject(early('rt-explicit-conversion'));
});

test('a field a literal cannot name keeps the class from being filled', () => {
  for (const field of ['#s: uint8 = 0;', 'protected s: uint8 = 0;', 'accessor s: uint8 = 0;']) {
    expect(observeScript(`class V { ${field} x: uint8 = 0; } const v = { x: 1 } := V;`), field).toMatchObject(early('rt-explicit-conversion'));
  }
  expectThrown('class V { #s: uint8 = 0; x: uint8 = 0; } const v = { x: 1 } := V;', 'its field "#s" is private, and a literal cannot name it');
  expectThrown('class V { #s: uint8 = 0; x: uint8 = 0; } function mk<T: type>(): T { return { x: 1 } := T; } mk.<V>();', 'its field "#s" is private');
  // A private method holds nothing, and does not.
  expect(evaluated('class V { x: uint8 = 0; #twice() { return this.x * 2; } get double() { return this.#twice(); } } const v = { x: 3 } := V; String(v.double);')).toBe('6');
});

test('the literal names fields of the class, and only fields', () => {
  for (const literal of ['{ x: 1, z: 2 }', '{ ...o }', '{ [k]: 1 }', '{ x: 1, m() {} }', '{ get x() { return 1; } }', '{ __proto__: null }']) {
    expect(observeScript(`${V}const o = { x: 1 }; const k = "x"; const v = ${literal} := V;`), literal).toMatchObject(early('rt-explicit-conversion'));
  }
  expectThrown(`${V}const v = { x: 1, z: 2 } := V;`, '"V" has no field named "z"');
  expectThrown(`${V}const o = { x: 1 }; const v = { ...o } := V;`, 'names its fields, and this one has "a spread"');
  // A method of the class is not a field.
  expect(observeScript('class V { x: uint8 = 0; m() { return 1; } } const v = { m: 1 } := V;')).toMatchObject(early('rt-explicit-conversion'));
  expectThrown(`${V}function mk<T: type>(): T { return { x: 1, z: 2 } := T; } mk.<V>();`, '"V" has no field named "z"');
});

test('what is not an object literal converts as it did, and an annotation does not convert', () => {
  // The fill is for a literal: a value that is an object already is not made into an instance.
  expectThrown(`${V}const o = { x: 1, y: 2 }; const v = o := V;`, 'is not assignable to "V"');
  expectThrown(`${V}const v = JSON.parse('{"x":1}') := V;`, 'is not assignable to "V"');
  // `const v: V = { ... }` is not a conversion, and says how to write one.
  expect(observeScript(`${V}const v: V = { x: 1 };`)).toMatchObject(early('rt-assignability'));
  expectThrown(`${V}const v: V = { x: 1 };`, 'write "{ ... } := V" to construct one from its fields');
  // A class over a built-in is made by that built-in's constructor.
  expectThrown('class L extends Array { n: uint8 = 0; } const l = { n: 1 } := L;', '"Array" in its chain is not a class definition');
});
