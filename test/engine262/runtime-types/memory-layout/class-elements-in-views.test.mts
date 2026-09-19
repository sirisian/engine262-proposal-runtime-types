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

test('a nested class field is still refused, as it is for placement itself', () => {
  // Pre-existing and not a property of views: `new(buf, 0) Outer()` refuses the
  // same read, so `ReadPlacedField` is where it lives.
  const nested = 'class I { n: uint8 = 0; } class O { i: I; m: uint8 = 0; } ';
  expectThrown(`${nested}const s = Span.<O>(new ArrayBuffer(8)); const ref e = s[0]; e.i.n = 4;`,
    'cannot be placed in a buffer');
  expectThrown(`${nested}const o = new(new ArrayBuffer(8), 0) O(); o.i.n;`,
    'cannot be placed in a buffer');
});
