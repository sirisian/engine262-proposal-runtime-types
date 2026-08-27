import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * #sec-value-type-copying, over a VALUE TYPE CLASS.
 *
 * #sec-typed-classes: "A typed class is a value type class when every one of its
 * fields has a type that is a value type. Instances ... are values in the sense
 * of #sec-value-types ... and assigning one copies it."
 *
 * The copy is taken at the BINDING, the ASSIGNMENT and the READ, keyed on what
 * the initializer or right-hand side IS - never at a type boundary. A boundary
 * is a check site and may be skipped where the source provably satisfies the
 * target; a skipped check is nothing, and a skipped copy is an alias. That
 * distinction is the whole of why four earlier attempts failed.
 */

const V = 'class P { x: uint8 = 0; } ';

test('a NAME or a READ copies', () => {
  // "Assigning a value of a value type, passing one as an argument, and
  // returning one each COPY it."
  expect(evaluated(`${V} const a = new P(); a.x = 1; const b = a; b.x = 9; String(a.x);`)).toBe('1');
  expect(evaluated(`${V} const a = new P(); a.x = 1; let b = new P(); b = a; b.x = 9; String(a.x);`)).toBe('1');
  expect(evaluated(`${V} const a = new P(); a.x = 1; var b = a; b.x = 9; String(a.x);`)).toBe('1');
  // "A read of a field or an element into any of those positions is one of them,
  // so `e` in `let e: V = arr[0]` holds a copy and writing to it does not
  // disturb the element."
  expect(evaluated(`${V} const arr: [2].<P> = [new P(), new P()]; arr[0].x = 1; const d = arr[0]; d.x = 9; String(arr[0].x);`)).toBe('1');
  expect(evaluated(`${V} class N { p: P = new P(); } const n = new N(); n.p.x = 1; const e = n.p; e.x = 9; String(n.p.x);`)).toBe('1');
  // A field store and an argument, which already copied.
  expect(evaluated(`${V} class H { p: P = new P(); } const a = new P(); a.x = 1; const h = new H(); h.p = a; a.x = 5; String(h.p.x);`)).toBe('1');
  expect(evaluated(`${V} function f(p: P) { p.x = 9; } const a = new P(); a.x = 1; f(a); String(a.x);`)).toBe('1');
});

test('CONSTRUCTION does not copy', () => {
  // "A constructor call, an object-literal conversion, and a `return` of a newly
  // constructed value build their result directly in the destination ... This is
  // the copy elision that C++17 guarantees for prvalues, REQUIRED here rather
  // than permitted."
  //
  // Told apart from a copy site by the initializer's FORM: a `new` and a call
  // each PRODUCE a value, where a name or a read DENOTES one that exists.
  expect(evaluated(`${V} const a = new P(); a.x = 7; String(a.x);`)).toBe('7');
  expect(evaluated(`${V} function g(): P { const p = new P(); p.x = 3; return p; } const c = g(); String(c.x);`)).toBe('3');
});

test('the copy carries what the instance carries', () => {
  // Four attempts failed here, each losing a different thing: the fields, the
  // constructor list, the per-property type marks, the prototype.
  expect(evaluated(`${V} const a = new P(); const b = a; String(Reflect.typeOf(b) === (type P));`)).toBe('true');
  // ...so structural equality still holds, at both operations.
  expect(evaluated(`${V} const a = new P(); a.x = 1; const b = a; String(a === b) + String(Object.is(a, b));`)).toBe('truetrue');
  // ...the instance is still sealed, per #sec-typed-storage.
  expect(evaluated(`${V} const a = new P(); const b = a; String(Object.isSealed(b));`)).toBe('true');
  // ...and a store to a field is still checked against its declared type.
  expect(evaluated(`${V} const a = new P(); const b = a; try { b.x = 300; "no"; } catch (e) { "caught"; }`)).toBe('caught');
});

test('nothing that is NOT a value type class is copied', () => {
  // A class with a `string` field is not one - #sec-value-types lists "a value
  // type, a string, or an enumerator" as three things - so its instances alias,
  // which is correct for an Object.
  expect(evaluated('class Q { s: string = ""; x: uint8 = 0; } const a = new Q(); a.x = 1; const b = a; b.x = 9; String(a.x);')).toBe('9');
  expect(evaluated('const a = { x: 1 }; const b = a; b.x = 9; String(a.x);')).toBe('9');
  expect(evaluated('const a = [1, 2]; const b = a; b[0] = 9; String(a[0]);')).toBe('9');
  expect(evaluated('const m = new Map(); const n = m; n.set(1, 2); String(m.size);')).toBe('1');
});

test('a PRIVATE field is copied; a private METHOD is shared', () => {
  // Private state is not reachable through Get and lives in [[PrivateElements]].
  // The copy bailed out entirely while that path was unwritten, leaving a value
  // type class with any private field aliasing - the conservative answer, since
  // a copy missing half its state is worse than none.
  //
  // A private FIELD holds its own value and is copied. A private METHOD or
  // ACCESSOR belongs to the CLASS and is shared by every instance, so its record
  // is carried across as it stands: duplicating one would give the copy a second
  // function object for a single declaration.
  const W = 'class W { #s: uint8 = 0; get s() { return this.#s; } set s(v: uint8) { this.#s = v; } } ';
  expect(evaluated(`${W} const a = new W(); a.s = (1 := uint8); const b = a; b.s = (9 := uint8); String(a.s);`)).toBe('1');
  expect(evaluated(`${W} const a = new W(); a.s = (1 := uint8); const b = a; String(b.s);`)).toBe('1');
  // A private method still works through the copy.
  expect(evaluated('class M { #n: uint8 = 0; #twice() { return 2; } run() { return this.#twice(); } } '
    + 'const a = new M(); const b = a; String(b.run());')).toBe('2');
  // A class with BOTH copies both halves independently.
  expect(evaluated('class X { #p: uint8 = 0; x: uint8 = 0; get p() { return this.#p; } set p(v: uint8) { this.#p = v; } } '
    + 'const a = new X(); a.x = 1; a.p = (2 := uint8); const b = a; b.x = 9; b.p = (8 := uint8); '
    + 'String(a.x) + "/" + String(a.p);')).toBe('1/2');
});

test('a TYPED array literal copies its elements', () => {
  // #sec-value-type-copying names "storing into ... an array element" a copy
  // position, and a typed array literal IS that store: `const arr: [1].<P> =
  // [a]` and `arr[0] = a` are one operation written two ways, and they
  // disagreed - the second copied and the first aliased.
  //
  // The clause's elision does NOT cover this. It exempts "an object-literal
  // CONVERSION" - a literal BECOMING a value type, as in `{ … } := Matrix4` -
  // not a literal whose ELEMENTS are value type instances. Reading it the second
  // way would elide a copy the clause requires two sentences earlier.
  const V = 'class P { x: uint8 = 0; } ';
  expect(evaluated(`${V} const a = new P(); a.x = 1; const arr: [1].<P> = [a]; arr[0].x = 9; String(a.x);`)).toBe('1');
  // A DYNAMIC annotation reaches the stamp by a different path and needs the
  // rule said again - the third near-identical array branch it has taken.
  expect(evaluated(`${V} const a = new P(); a.x = 1; const arr: [].<P> = [a]; arr[0].x = 9; String(a.x);`)).toBe('1');
  // One source used twice gives two independent elements.
  expect(evaluated(`${V} const a = new P(); a.x = 1; const arr: [2].<P> = [a, a]; arr[0].x = 9; String(a.x) + "/" + String(arr[1].x);`)).toBe('1/1');
});

test('the literal cases that must NOT copy still do not', () => {
  const V = 'class P { x: uint8 = 0; } ';
  // A literal of CONSTRUCTIONS builds in place, which the clause requires.
  expect(evaluated(`${V} const arr: [1].<P> = [new P()]; arr[0].x = 7; String(arr[0].x);`)).toBe('7');
  // An UNTYPED array literal is not a typed store: a plain Array holds a
  // reference, and `const arr = [a]` is the same answer as `arr[0] = a` on one.
  expect(evaluated(`${V} const a = new P(); a.x = 1; const arr = [a]; arr[0].x = 9; String(a.x);`)).toBe('9');
  // A plain OBJECT literal's property is not a "field" in the clause's sense.
  expect(evaluated(`${V} const a = new P(); a.x = 1; const o = { p: a }; o.p.x = 9; String(a.x);`)).toBe('9');
  // The non-value-type array surface is untouched, including the empty-array
  // stamp the elision branch exists for.
  expect(evaluated('const arr: [2].<uint8> = [1, 2]; String(arr[0]) + "/" + String(arr.length);')).toBe('1/2');
  expect(evaluated('const b: [].<uint8> = []; b.push((65 := uint8)); String(b.length);')).toBe('1');
});
