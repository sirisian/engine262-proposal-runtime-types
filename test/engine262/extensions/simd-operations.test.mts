import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../readme/harness.mts';

/**
 * SIMD operations, sectioned by the phases of the coverage plan so that what is
 * covered reads against the instruction tables.
 *
 * The regression floor comes first: it is what every later phase must not
 * break, and the two most fragile entries are the ambiguity error - which every
 * new comparison result form threatens - and masks behaving as ordinary
 * vectors.
 */

// -- regression floor ---------------------------------------------------------
test('construction, lanes, and permutation', () => {
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a.x);')).toBe('1');
  expect(evaluated('const a = float32x4(7); String(a.w);')).toBe('7');
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a.lane.<0>());')).toBe('1');
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a.withLane.<0>(9).x);')).toBe('9');
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a[2]);')).toBe('3');
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a.xyxy.z);')).toBe('1');
  expect(evaluated('const a = float32x4(1, 2, 3, 4); const b = float32x4(5, 6, 7, 8);'
    + ' String(a.shuffle.<0, 1, 4, 5>(b).z);')).toBe('5');
});

test('arithmetic and reduction', () => {
  expect(evaluated('const a = float32x4(4, 4, 4, 4); const b = float32x4(2, 2, 2, 2);'
    + " String((a + b).x) + ',' + String((a - b).x) + ',' + String((a * b).x) + ',' + String((a / b).x);")).toBe('6,2,8,2');
  expect(evaluated('const a = int32x4(1, 2, 3, 4); const b = int32x4(4, 3, 2, 1);'
    + " String((a & b).x) + ',' + String((a | b).x) + ',' + String((a ^ b).x);")).toBe('0,5,5');
  expect(evaluated('const a = int32x4(1, 2, 3, 4); const b = int32x4(4, 3, 2, 1); String((a << b).x);')).toBe('16');
  expect(evaluated('const a = int32x4(1, 2, 3, 4); const b = int32x4(4, 3, 2, 1); String((a % b).x);')).toBe('1');
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a.sum());')).toBe('10');
});

// -- phase 1: equality comparisons -------------------------------------------
/**
 * A comparison between vectors of one shape yields one lane per input lane, and
 * equality is a comparison like any other - Intel's `_mm_cmpeq_epi32` beside
 * its `_mm_cmpgt_epi32`. Only the ORDERING operators reached the vector path,
 * so `a == b` fell through to the scalar comparison and answered one boolean.
 */
test('equality between vectors yields a mask', () => {
  const EQ = 'const m: boolean32x4 = int32x4(0, 1, 2, 3) == int32x4(0, 1, 3, 2); ';
  const NE = 'const m: boolean32x4 = int32x4(0, 1, 2, 3) != int32x4(0, 1, 3, 2); ';
  // lane 0 matches, lane 2 does not; a set lane is all-ones and a clear one all-zero
  expect(evaluated(`${EQ}String(m.lane.<0>().all());`)).toBe('true');
  expect(evaluated(`${EQ}String(m.lane.<2>().any());`)).toBe('false');
  expect(evaluated(`${NE}String(m.lane.<0>().any());`)).toBe('false');
  expect(evaluated(`${NE}String(m.lane.<2>().all());`)).toBe('true');
  // and on float lanes
  expect(evaluated('const m: boolean32x4 = float32x4(1, 2, 3, 4) == float32x4(1, 9, 3, 9);'
    + ' String(m.lane.<0>().all()) + "," + String(m.lane.<1>().any());')).toBe('true,false');
});

test('a NaN lane follows the scalar operator, ordered or unordered', () => {
  // `==` is ordered, so a NaN lane is clear - `NaN == NaN` is false
  expect(evaluated('const m: boolean32x4 = float32x4(NaN, 1, 1, 1) == float32x4(NaN, 1, 1, 1);'
    + ' String(m.lane.<0>().any());')).toBe('false');
  // `!=` is unordered, so a NaN lane is SET - `NaN != NaN` is true
  expect(evaluated('const m: boolean32x4 = float32x4(NaN, 1, 1, 1) != float32x4(NaN, 1, 1, 1);'
    + ' String(m.lane.<0>().all());')).toBe('true');
  // the ordering operators are ordered too
  expect(evaluated('const m: boolean32x4 = float32x4(NaN, 1, 1, 1) < float32x4(NaN, 2, 2, 2);'
    + ' String(m.lane.<0>().any());')).toBe('false');
});

test('the comparison rules around equality are unchanged', () => {
  // a comparison with no expected type is still ambiguous among its result forms
  expectThrown('const m = int32x4(0, 1, 2, 3) == int32x4(0, 1, 3, 2);');
  // vectors of different shapes are still refused
  expectThrown('const m: boolean32x4 = int32x4(0, 1, 2, 3) == float32x4(0, 1, 3, 2);');
  // ordering comparisons still produce a mask
  expect(evaluated('const m: boolean32x4 = float32x4(1, 2, 3, 4) < float32x4(4, 3, 2, 1);'
    + ' String(m.lane.<0>().all());')).toBe('true');
  // scalar equality is untouched
  expect(evaluated('String(1 == 1) + "," + String(NaN == NaN) + "," + String(NaN != NaN);')).toBe('true,false,true');
  // and strict equality keeps its own semantics rather than comparing lanes
  expect(evaluated('String(int32x4(1, 2, 3, 4) === int32x4(1, 2, 3, 4));')).toBe('false');
});

// -- phase 2: mask consumers --------------------------------------------------
/**
 * A comparison produces a mask in two shapes: the COMPACT one, a lane per input
 * lane and one bit per lane, and the WIDE one, a lane of the boolean type of
 * the same width as the compared element. Only the compact shape was recognised
 * as a mask, so `all`, `any`, and `select` were absent from the very value the
 * design's examples call them on - `const m: boolean32x4 = a < b; if (m.any())`.
 */
test('a wide mask answers the operations that consume a mask', () => {
  const M = 'const a = float32x4(1, 2, 3, 4); const b = float32x4(4, 3, 2, 1);'
    + ' const m: boolean32x4 = a < b; ';
  expect(evaluated(`${M}String(m.any());`)).toBe('true');
  expect(evaluated(`${M}String(m.all());`)).toBe('false');
  // all set, and none set
  expect(evaluated('const m: boolean32x4 = float32x4(1, 1, 1, 1) < float32x4(2, 2, 2, 2);'
    + ' String(m.all()) + "," + String(m.any());')).toBe('true,true');
  expect(evaluated('const m: boolean32x4 = float32x4(9, 9, 9, 9) < float32x4(2, 2, 2, 2);'
    + ' String(m.all()) + "," + String(m.any());')).toBe('false,false');
});

test('select takes a lane from each arm by the mask', () => {
  const M = 'const m: boolean32x4 = float32x4(1, 2, 9, 9) < float32x4(5, 5, 0, 0); ';
  // lanes 0 and 1 are set, 2 and 3 are clear
  expect(evaluated(`${M}const s = m.select(float32x4(10, 20, 30, 40), float32x4(50, 60, 70, 80));`
    + ' String(s.x) + "," + String(s.y) + "," + String(s.z) + "," + String(s.w);')).toBe('10,20,70,80');
  // "U is not the receiver's lane type": a mask selects between vectors of any
  // lane type sharing its lane count
  expect(evaluated(`${M}String(m.select(int32x4(1, 1, 1, 1), int32x4(2, 2, 2, 2)).x);`)).toBe('1');
  // both arms must be one type, and must share the mask's lane count
  expectThrown(`${M}m.select(int32x4(1, 1, 1, 1), float32x4(2, 2, 2, 2));`);
  expectThrown(`${M}m.select(float64x2(1, 1), float64x2(2, 2));`);
});

test('the compact mask and non-masks are unchanged', () => {
  // a bit-lane vector is a mask and always was
  expect(evaluated('const b: boolean8 = (1 := boolean1); String(b.all()) + "," + String(b.any());')).toBe('false,true');
  // a vector that is not a mask has no such member
  expectThrown('float32x4(1, 2, 3, 4).all();');
  // and a mask is still an ordinary vector: it swizzles and indexes
  const M = 'const m: boolean32x4 = float32x4(1, 2, 9, 9) < float32x4(5, 5, 0, 0); ';
  expect(evaluated(`${M}String(m.xyxy.x.all()) + "," + String(m[2].any());`)).toBe('true,false');
});
