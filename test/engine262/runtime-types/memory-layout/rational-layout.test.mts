import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * A RATIONAL HAS A LAYOUT. rational.md: "`rational.<N>` is a value type holding
 * two `int.<N>` fields, a numerator and a denominator ... It occupies `2N` bits
 * with the alignment of `int.<N>`. The bare name `rational` is `rational.<64>` -
 * two `int64`, sixteen bytes." And: "Being a value type, a `rational` copies on
 * assignment, lives inline in a `[].<rational>` as interleaved
 * numerator/denominator pairs, and splits into numerator and denominator columns
 * under structure of arrays."
 *
 * It had none, so none of that worked: a `rational` field and a `[N].<rational>`
 * both answered "this type has no layout", and the type the document describes
 * as living inline could not be placed anywhere at all.
 *
 * The shape is `complex`'s, for the same reason - a pair of components laid out
 * as two of them, aligned as ONE component rather than as the whole width, which
 * is what makes the buffer interleaved rather than a sequence of padded records.
 */

test('a rational reports its width and alignment', () => {
  expect(evaluated('const r: rational = 1/2; String(Reflect.typeOf(r).byteLength);')).toBe('16');
  expect(evaluated('const r: rational = 1/2; String(Reflect.typeOf(r).alignment);')).toBe('8');
});

test('a rational may be a field', () => {
  expect(evaluated('class C { r: rational; } String(C.byteLength);')).toBe('16');
  expect(evaluated('class C { r: rational; } String(C.isPlainData);')).toBe('true');
  expect(evaluated('class C { r: rational; } const c = new C(); String(c.r);')).toBe('0');
  // A narrower width lays out as two of it.
  expect(evaluated('class C { r: rational.<32>; } String(C.byteLength);')).toBe('8');
});

test('a rational may be an array element', () => {
  expect(evaluated('const a: [4].<rational>; String(Reflect.typeOf(a).byteLength);')).toBe('64');
  expect(evaluated('const a: [4].<rational>; a[0] = 1 / 3; String(a[0]);')).toBe('1/3');
});

test('a class carrying one is laid out', () => {
  expect(evaluated('class C { r: rational; n: uint8 = 0; } String(C.hasLayout);')).toBe('true');
});

test('the neighbouring pair type is unchanged', () => {
  // `complex` is the precedent this follows; it must not move.
  expect(evaluated('String(complex128.byteLength);')).toBe('16');
  expect(evaluated('String(complex128.alignment);')).toBe('8');
});
