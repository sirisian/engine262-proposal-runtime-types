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
  expect(evaluated(`class A { x: uint8 = 1; }
    class S { s: string = ''; }
    dynamic class D { x = 1; }
    class C { d: D | null = null; }
    [A.hasLayout, A.isPlainData,
     S.hasLayout, S.isPlainData,
     C.hasLayout, C.isPlainData].join(',');`)).toBe('true,true,false,false,true,false');
});

test('plainness descends through fields, arrays, enums and brands', () => {
  expect(evaluated(`class V { x: float32 = 0; y: float32 = 0; }
    class Nest { v: V; n: uint8 = 0; }
    class Arr { a: [4].<V>; }
    class Dyn { a: [].<V> = []; }
    enum E: uint16 { A = 1 }
    class WithEnum { e: E = E.A; }
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

test('a reference type reports no layout, though a field of it costs one', () => {
  // `table-layout-by-type` gives a reference type no layout - "a reference's
  // width is the implementation's business" - so the reported answer and the
  // storage answer are different questions and now different functions.
  expect(evaluated(`reference class R { x: uint8 = 1; }
    class H { r: R | null = null; }
    R.hasLayout + '/' + H.byteLength;`)).toBe('false/8');
  expectThrown('reference class R { x: uint8 = 1; } R.byteLength;', 'has no layout');
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
  expect(evaluated(`class V { x: float32 = 0; y: float32 = 0; }
    String(Span.<V>(new ArrayBuffer(64)).length);`)).toBe('8');
  expect(evaluated('String(Span.<uint8>(new ArrayBuffer(64)).length);')).toBe('64');
});

test('value classes copy and reference classes alias', () => {
  // Guards the five copy sites that used to read value-type-ness off
  // `LayoutOf(t) !== null` and patch the reference case back out by hand; they
  // now ask IsValueTypeClass once.
  expect(evaluated(`class V { x: uint8 = 1; }
    reference class R { x: uint8 = 1; }
    const a = new V(); const b = a; b.x = 9;
    const p = new R(); const q = p; q.x = 9;
    a.x + '/' + p.x;`)).toBe('1/9');
});
