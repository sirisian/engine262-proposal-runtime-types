import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from './harness.mts';

/**
 * Spec: #sec-coercejsonvalue, closing paragraph.
 *
 * > The conversions this operation does not perform are the DEFERRED part of
 * > the extension: ... the exact wide numeric types (the 64-bit integers,
 * > `decimal128`, and `bigint`) WHOSE DIGITS MUST CONVERT WITHOUT FIRST
 * > ROUNDING THROUGH A NUMBER ...
 *
 * The engine converts them by rounding through a Number, the document having
 * been parsed into one before coercion runs. Below 2**53 that rounding is the
 * identity and the conversion is sound; above it, it is not.
 *
 * `JSON.parse.<uint64>('9007199254740993')` answered 9007199254740992 - a
 * document round-tripped, validated, and came back holding A DIFFERENT NUMBER,
 * which is the failure the deferral exists to prevent.
 */

test('an integer token a double cannot hold exactly is refused', () => {
  expectThrownKind("JSON.parse.<uint64>('9007199254740993');", 'TypeError');
  expectThrownKind("JSON.parse.<int64>('-9007199254740993');", 'TypeError');
  // The bound is INCLUSIVE. `9007199254740993` parses to exactly 2**53, so an
  // exclusive bound would let through the very token that motivated the guard.
  // The exact token `9007199254740992` is refused with it, unavoidably: both
  // produce this double and nothing at this point can tell them apart.
  expectThrownKind("JSON.parse.<uint64>('9007199254740992');", 'TypeError');
  // The largest of these were already refused by accident, the rounded value
  // landing outside the type's range. Only the band between 2**53 and the
  // type's maximum was silent.
  expectThrownKind("JSON.parse.<uint64>('18446744073709551615');", 'TypeError');
});

test('every integer a double holds exactly still converts', () => {
  expect(evaluated("String(JSON.parse.<uint64>('9007199254740991'));")).toBe('9007199254740991');
  expect(evaluated("String(JSON.parse.<uint64>('42'));")).toBe('42');
  expect(evaluated("String(JSON.parse.<uint32>('4294967295'));")).toBe('4294967295');
  expect(evaluated("String(JSON.parse.<uint8>('42'));")).toBe('42');
  expect(evaluated('String(JSON.parse.<{ a: uint32 }>(\'{"a":7}\').a);')).toBe('7');
});

test('a FLOAT target is untouched, having an answer for a large value', () => {
  // The exactness question does not arise where the target rounds by design.
  expect(evaluated("String(JSON.parse.<float64>('1e300'));")).toBe('1e+300');
  expect(evaluated("String(JSON.parse.<float64>('0.1'));")).toBe('0.1');
  expect(evaluated("String(JSON.parse.<float64>('9007199254740993'));")).toBe('9007199254740992');
});

test('the untyped `number` target is untouched', () => {
  // `number` IS the Number type, so no conversion happens and nothing is lost
  // that parsing had not already lost.
  expect(evaluated("String(JSON.parse.<number>('9007199254740993'));")).toBe('9007199254740992');
});

test('the integer range check still reports what it always did', () => {
  expectThrownKind("JSON.parse.<uint8>('300');", 'TypeError');
  expectThrownKind("JSON.parse.<uint8>('1.5');", 'TypeError');
  expectThrownKind('JSON.parse.<uint8>(\'"5"\');', 'TypeError');
});
