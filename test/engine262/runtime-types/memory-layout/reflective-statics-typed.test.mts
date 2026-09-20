import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * EVERY REFLECTIVE QUANTITY IS A `uint64`. An array's `length`, `byteOffset` and
 * `byteLength` and a window's `length` already were; a type's `byteLength` and
 * `alignment` were plain Numbers, so the two halves of one surface could not be
 * combined:
 *
 *   a.length * V.byteLength    // "a value of the number type and a uint64 are disjoint"
 *
 * That is the most ordinary layout computation the proposal has, and it did not
 * compile. It does now.
 *
 * What this does NOT do is make the numeric family permissive. An exact width is
 * still required of the other operand, so `count * V.byteLength` for a `uint8`
 * count is still refused and the program writes the conversion - which is what
 * the design's own examples were missing, under every direction, and why they
 * were corrected rather than treated as evidence that these were mistyped.
 */
const V = 'class V { x: uint32 = 0; y: uint32 = 0; } const a: [8].<uint8>; ';

test('a reflective quantity combines with another', () => {
  expect(evaluated(`${V}String(a.length * V.byteLength);`)).toBe('64');
  expect(evaluated(`${V}String(V.byteLength * V.alignment);`)).toBe('32');
  expect(evaluated(`${V}String(a.length * a.byteLength);`)).toBe('64');
});

test('the statics report the same type the instance accessors do', () => {
  expect(evaluated(`${V}String(Reflect.typeOf(V.byteLength) === uint64);`)).toBe('true');
  expect(evaluated(`${V}String(Reflect.typeOf(V.alignment) === uint64);`)).toBe('true');
  expect(evaluated('String(Reflect.typeOf(uint32.byteLength) === uint64);')).toBe('true');
  expect(evaluated(`${V}String(Reflect.typeOf(a.length) === uint64);`)).toBe('true');
});

test('the untyped positions a static reaches still accept it', () => {
  // Measured across the suite before the change: every use is one of these.
  expect(evaluated(`${V}String(V.byteLength);`)).toBe('8');
  expect(evaluated(`${V}V.byteLength + '/' + V.alignment;`)).toBe('8/4');
  expect(evaluated(`${V}String(V.byteLength === 8);`)).toBe('true');
  // And an array extent, the one place a static appears in a TYPE position.
  expect(evaluated('class W { q: float32 = 0; } const b: [W.byteLength * 4].<uint8>; String(b.length);')).toBe('16');
});

test('a narrower counter still writes the conversion', () => {
  const M = 'class Vertex { x: float32 = 0; y: float32 = 0; z: float32 = 0; } const mesh: [120].<uint8>; ';
  expectThrown(`${M}const count: uint8 = 2; Span.<uint8>(mesh).slice(0, count * Vertex.byteLength);`,
    'different numeric types');
  // memorylayout.md's example, as corrected.
  expect(evaluated(`${M}const count: uint8 = 2;
    String(Span.<uint8>(mesh).slice(0, (count := uint64) * Vertex.byteLength).length);`)).toBe('24');
});

test('a type with no layout still has neither', () => {
  expectThrown('class S { s: string = ""; } S.byteLength;', 'has no layout');
});
