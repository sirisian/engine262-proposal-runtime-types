import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * A window over a BUFFER refused every element access on a class element -
 * `an element of this type cannot be viewed in a buffer` - while a window over
 * an owned ARRAY read the same element correctly. One type stood for two
 * behaviours at the same operation.
 *
 * The machinery already existed: a placement `new` lands a class on existing
 * bytes, and an SoA column builds the same object for a nested field. A class
 * element now reads through that placement-backed instance.
 *
 * The COPY/ALIAS split is the README's, unchanged: `const ref e = view[i]`
 * aliases the buffer, and a plain `const e = view[i]` copies, because the copy
 * happens where the binding is made rather than at the element read.
 */
const V = 'class V { x: uint8 = 0; y: uint8 = 0; } ';

test('a class element reads and writes through to the buffer', () => {
  expect(evaluated(`${V}const b = new ArrayBuffer(8); const s = Span.<V>(b); String(s[0].x);`)).toBe('0');
  // Checked through a SECOND view of the same bytes, not through the one that
  // wrote them: a probe that reads back its own write proves nothing.
  expect(evaluated(`${V}const b = new ArrayBuffer(8); const s = Span.<V>(b);
    const ref e = s[0]; e.x = 7; String(new Uint8Array(b)[0]);`)).toBe('7');
  expect(evaluated(`${V}const b = new ArrayBuffer(8);
    const s1 = Span.<V>(b); const s2 = Span.<V>(b);
    const ref e = s1[0]; e.x = 6; String(s2[0].x);`)).toBe('6');
});

test('an element lands at its own stride', () => {
  expect(evaluated(`${V}const b = new ArrayBuffer(8); const s = Span.<V>(b);
    const ref e = s[1]; e.x = 9;
    const r = new Uint8Array(b); r[0] + '/' + r[2];`)).toBe('0/9');
});

test('a plain read copies and a ref read aliases', () => {
  // The distinction the README draws twice over, once in each form.
  expect(evaluated(`${V}const b = new ArrayBuffer(8); const s = Span.<V>(b);
    const e = s[0]; e.x = 7; String(new Uint8Array(b)[0]);`)).toBe('0');
  expect(evaluated(`${V}const b = new ArrayBuffer(8); const s = Span.<V>(b);
    const ref e = s[0]; e.x = 7; String(new Uint8Array(b)[0]);`)).toBe('7');
});

test('a whole element may be assigned', () => {
  expect(evaluated(`${V}const b = new ArrayBuffer(8); const s = Span.<V>(b);
    const v = new V(); v.x = 5; s[0] = v; String(new Uint8Array(b)[0]);`)).toBe('5');
});

test('the guards and the scalar path are untouched', () => {
  // A reference-bearing element is still refused where the view is made, which
  // is what keeps the element read above from ever seeing one.
  expectThrown(`dynamic class D { y = 1; } class C { d: D | null = null; }
    Span.<C>(new ArrayBuffer(32));`, 'cannot be viewed in a buffer');
  expectThrown(`${V}const s = Span.<V>(new ArrayBuffer(8)); s[9].x;`, 'is out of range');
  expect(evaluated('const s = Span.<uint8>(new ArrayBuffer(8)); s[0] = 3; String(s[0]);')).toBe('3');
});

test('a nested class field reads and writes through too', () => {
  // This pinned the opposite. The refusal was never a property of views -
  // `new(buf, 0) Outer()` refused the same read - so it lived in
  // `ReadPlacedField`, where `BufferElementType` answers only scalars and
  // nothing asked what else a field might be. A nested field now reads through
  // the same placement-backed instance a class ELEMENT gets.
  const nested = 'class I { n: uint8 = 0; } class O { i: I; m: uint8 = 0; } ';
  expect(evaluated(`${nested}const b = new ArrayBuffer(8); const s = Span.<O>(b);
    const ref e = s[0]; e.i.n = 5; String(new Uint8Array(b)[0]);`)).toBe('5');
  expect(evaluated(`${nested}const b = new ArrayBuffer(8);
    const o = new(b, 0) O(); o.i.n = 4; String(new Uint8Array(b)[0]);`)).toBe('4');
  // The sibling field is placed after the nested one, not over it.
  expect(evaluated(`${nested}const b = new ArrayBuffer(8); const o = new(b, 0) O(); o.m = 7;
    const r = new Uint8Array(b); r[0] + '/' + r[1];`)).toBe('0/7');
});

/**
 * `@endian` fixes a field's byte order. It parsed, set its descriptor key, and
 * changed nothing: `@endian('big')`, `@endian('little')` and no decorator all
 * wrote the same bytes.
 *
 * `layout.mts` says where it belongs - "`offsetBit` and `endian` are carried and
 * have no effect on the byte walk ... the second fixes a field's byte order,
 * which is a property of READING AND WRITING rather than of placement" - so the
 * placement record now carries it and both buffer calls consult it.
 *
 * The parameter is the SEVENTH of `GetValueFromBuffer` / `SetValueInBuffer`.
 * The fourth is `_isTypedArray`, and passing the order there type-checks, builds
 * and does nothing, which is what made this look like a plumbing failure long
 * after the plumbing was correct.
 */
test('@endian fixes a field\u2019s byte order', () => {
  const big = `class W { @endian('big') v: uint16 = 0; } `;
  const none = 'class W { v: uint16 = 0; } ';
  const body = `const b = new ArrayBuffer(4); const s = Span.<W>(b);
    const ref e = s[0]; e.v = 258; const r = new Uint8Array(b); r[0] + '/' + r[1];`;
  expect(evaluated(big + body)).toBe('1/2');
  expect(evaluated(none + body)).toBe('2/1');
});

test('a field round-trips through its own order', () => {
  expect(evaluated(`class W { @endian('big') v: uint16 = 0; }
    const b = new ArrayBuffer(4); const s = Span.<W>(b); const ref e = s[0]; e.v = 258; String(e.v);`)).toBe('258');
  expect(evaluated(`class W { @endian('big') v: uint32 = 0; }
    const b = new ArrayBuffer(8); const s = Span.<W>(b); const ref e = s[0]; e.v = 1;
    const r = new Uint8Array(b); r[0] + '/' + r[3];`)).toBe('0/1');
});

test('one class may mix orders, which is what a wire format needs', () => {
  // memorylayout.md: "a struct can mix native fields with big-endian network
  // fields in one declaration".
  expect(evaluated(`class P { @endian('big') a: uint16 = 0; b: uint16 = 0; }
    const b = new ArrayBuffer(8); const s = Span.<P>(b); const ref e = s[0]; e.a = 258; e.b = 258;
    const r = new Uint8Array(b); r[0] + '/' + r[1] + ' ' + r[2] + '/' + r[3];`)).toBe('1/2 2/1');
});

test('placement new honours it on the same path', () => {
  expect(evaluated(`class W { @endian('big') v: uint16 = 0; }
    const b = new ArrayBuffer(4); const w = new(b, 0) W(); w.v = 258;
    const r = new Uint8Array(b); r[0] + '/' + r[1];`)).toBe('1/2');
});

test('the README\u2019s own worked example runs', () => {
  // `const ref header = Span.<Header>(buffer)[0]; header.c.a = 10; buffer[3]`
  // is documented with the answer 10, and needed three things that were each
  // missing: a class element in a buffer-backed view, a nested class field
  // through a placement, and a byte-backed source. The first two are now here;
  // the third is why `buffer` is a `Uint8Array` rather than the `[100].<uint8>`
  // the README writes - an owned array's bytes are "specified but not
  // implemented in this engine", which is a separate gap.
  expect(evaluated(`
    @packed class HeaderSection { a: uint8 = 0; b: uint32 = 0; }
    @packed class Header { a: uint8 = 0; b: uint16 = 0; c: HeaderSection; }
    const buffer = new Uint8Array(100);
    const ref header = Span.<Header>(buffer)[0];
    header.c.a = 10;
    String(buffer[3]);`)).toBe('10');
});
