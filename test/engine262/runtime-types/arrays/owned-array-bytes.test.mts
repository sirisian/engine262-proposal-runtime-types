import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * `#sec-array-views` gives an owned array byte storage. This engine kept one in
 * its own representation, so `.buffer` answered "specified but not implemented"
 * - and the consequence reached past the accessor: a window could not be taken
 * over storage a program had already allocated.
 *
 * The bytes are materialised on FIRST REQUEST, so an array nothing views pays
 * nothing, which is what the `[N].<T>` pools are for. It is ONE-WAY: once the
 * bytes exist the array is backed by them, because re-representing it would
 * leave any window over the buffer reading storage nothing writes.
 *
 * A FIXED extent only. A dynamic `[].<T>` can grow, and a buffer sized to its
 * current length would either freeze it or drift out of step - so a dynamic
 * array still reports the limit, which the span tests pin.
 */

test('a fixed owned array yields its bytes', () => {
  expect(evaluated('const a: [8].<uint8>; String(a.buffer.byteLength);')).toBe('8');
  expect(evaluated('const a: [4].<uint32>; String(a.buffer.byteLength);')).toBe('16');
  expect(evaluated('const a: [4].<uint8>; String(a.byteOffset);')).toBe('0');
});

test('the values are there, and are the bytes', () => {
  expect(evaluated(`const a: [4].<uint8>; a[0] = 7; a[3] = 9; const b = a.buffer;
    String(a[0]) + '/' + String(a[3]);`)).toBe('7/9');
  expect(evaluated(`const a: [4].<uint8>; a[0] = 7; a[3] = 9;
    const r = new Uint8Array(a.buffer); String(r[0]) + '/' + String(r[3]);`)).toBe('7/9');
  // And the array stays live over them afterwards.
  expect(evaluated(`const a: [4].<uint8>; const b = a.buffer; a[1] = 5;
    String(new Uint8Array(b)[1]);`)).toBe('5');
});

test('a window may now be taken over owned storage', () => {
  expect(evaluated(`class V { x: uint8 = 0; y: uint8 = 0; }
    const buf: [8].<uint8>; const s = Span.<V>(buf.buffer); String(s.length);`)).toBe('4');
});

test('the design\u2019s worked example runs over an owned array', () => {
  // README: `const ref header = Span.<Header>(buffer)[0]; header.c.a = 10;`
  // with `buffer` a `[100].<uint8>`, documented as leaving `buffer[3]` at 10.
  // `.buffer` is still written explicitly here - the reinterpreting COERCION
  // `const s: Span.<Header> = buffer` remains a separate question.
  expect(evaluated(`
    @packed class HeaderSection { a: uint8 = 0; b: uint32 = 0; }
    @packed class Header { a: uint8 = 0; b: uint16 = 0; c: HeaderSection; }
    const buffer: [100].<uint8>;
    const ref header = Span.<Header>(buffer.buffer)[0];
    header.c.a = 10;
    String(buffer[3]);`)).toBe('10');
});

test('a dynamic array still reports the limit', () => {
  expectThrown('let a: [].<uint8> = [1, 2, 3]; a.buffer;', 'specified but not implemented');
});

/**
 * A FIXED OWNED ARRAY IS A VIEW SOURCE. Its bytes exist on request, so
 * `Span.<V>(buf)` is the same operation as `Span.<V>(buf.buffer)`; it was
 * refused only because the source was named rather than its storage, and the
 * message listed three sources while an owned array had become a fourth.
 *
 * The COERCION is deliberately not extended. `const s: Span.<V> = buf`
 * reinterprets eight `uint8`s as four `V`s, and a conversion between types "is
 * written explicitly rather than performed silently" - the call says so, the
 * declaration does not. The same-element coercion is unaffected, since
 * describing a `[4].<A>` as a `Span.<A>` re-describes nothing.
 */

test('a fixed owned array may be viewed directly', () => {
  expect(evaluated(`class V { x: uint8 = 0; y: uint8 = 0; }
    const buf: [8].<uint8>; String(Span.<V>(buf).length);`)).toBe('4');
  // The same window either way.
  expect(evaluated(`class V { x: uint8 = 0; y: uint8 = 0; }
    const buf: [8].<uint8>; String(Span.<V>(buf.buffer).length);`)).toBe('4');
  // And it is a window over the array, not a copy of it.
  expect(evaluated(`class V { x: uint8 = 0; y: uint8 = 0; }
    const buf: [8].<uint8>; const s = Span.<V>(buf);
    const ref e = s[0]; e.x = 7; String(buf[0]);`)).toBe('7');
  expect(evaluated(`class V { x: uint8 = 0; y: uint8 = 0; }
    const buf: [8].<uint8>; String(Span.<V>(buf, 2).length);`)).toBe('3');
});

test('a dynamic array is still not a view source', () => {
  expectThrown('class V { x: uint8 = 0; y: uint8 = 0; } let buf: [].<uint8> = [1,2,3,4]; Span.<V>(buf);',
    'a view needs an ArrayBuffer');
});

test('the coercion still refuses to reinterpret', () => {
  expectThrown('class V { x: uint8 = 0; y: uint8 = 0; } const buf: [8].<uint8>; const s: Span.<V> = buf;',
    'is not assignable to');
  // Same element type re-describes nothing and is unaffected.
  expect(evaluated('class A { x: uint8 = 1; } const p: [4].<A>; const s: Span.<A> = p; String(s.length);')).toBe('4');
});

test('a view holds whole elements, and the remainder is not one', () => {
  // Documented in `sec-array-views` rather than left to be discovered: the count
  // is the floor of the available bytes over the stride, measured from
  // `byteOffset`, so a trailing partial element is simply not in the view.
  const V = 'class V { x: uint8 = 0; y: uint8 = 0; } ';
  expect(evaluated(`${V}const buf: [7].<uint8>; String(Span.<V>(buf).length);`)).toBe('3');
  expect(evaluated(`${V}const buf: [8].<uint8>; String(Span.<V>(buf).length);`)).toBe('4');
  expect(evaluated(`${V}const buf: [9].<uint8>; String(Span.<V>(buf).length);`)).toBe('4');
  // From the offset, not from the start: 9 bytes at offset 1 leaves 8.
  expect(evaluated(`${V}const buf: [9].<uint8>; String(Span.<V>(buf, 1).length);`)).toBe('4');
});
