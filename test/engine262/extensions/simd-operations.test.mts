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

// -- phase 3: the remaining comparison result forms ---------------------------
/**
 * Three results are defined: the wide mask, the compact mask (a bit vector of
 * one bit per lane), and the compared vector type itself with its matching
 * lanes all-ones. The last is Intel's `_mm_cmpeq_epi32`, whose result is a
 * vector rather than a mask register and whose use is as the operand of a
 * bitwise AND.
 *
 * There is no `boolean4` shorthand - the `boolean`N names are bit WIDTHS, not
 * lane counts - so a four-lane compact mask is written `vector.<boolean1, 4>`.
 */
test('a comparison yields the compared vector type with all-ones lanes', () => {
  const C = 'int32x4(0, 1, 2, 3) == int32x4(0, 1, 3, 2)';
  expect(evaluated(`const v: int32x4 = ${C}; String(v.x) + "," + String(v.z);`)).toBe('-1,0');
  expect(evaluated('const v: uint32x4 = uint32x4(1, 2, 3, 4) == uint32x4(1, 9, 9, 9); String(v.x);')).toBe('4294967295');
  // a float lane reads the all-ones bits as a NaN, which is what the hardware writes
  expect(evaluated('const v: float32x4 = float32x4(1, 2, 3, 4) == float32x4(1, 9, 9, 9);'
    + ' String(v.x !== v.x);')).toBe('true');
  // every operator reaches the form, not just equality
  expect(evaluated('const v: int32x4 = int32x4(0, 1, 2, 3) != int32x4(0, 1, 3, 2);'
    + ' String(v.x) + "," + String(v.z);')).toBe('0,-1');
  expect(evaluated('const v: int32x4 = int32x4(1, 2, 9, 9) < int32x4(5, 5, 0, 0);'
    + ' String(v.x) + "," + String(v.z);')).toBe('-1,0');
});

test('the all-ones form is what a bitwise AND consumes', () => {
  // the reason the form exists: masking lanes without a branch
  const C = 'const v: int32x4 = int32x4(0, 1, 2, 3) == int32x4(0, 1, 3, 2); ';
  expect(evaluated(`${C}const kept = v & int32x4(7, 7, 7, 7);`
    + ' String(kept.x) + "," + String(kept.z);')).toBe('7,0');
});

test('the compact mask is a bit vector of one bit per lane', () => {
  const C = 'int32x4(0, 1, 2, 3) == int32x4(0, 1, 3, 2)';
  expect(evaluated(`const m: vector.<boolean1, 4> = ${C};`
    + ' String(m.all()) + "," + String(m.any());')).toBe('false,true');
  expect(evaluated(`const m: vector.<boolean1, 4> = ${C};`
    + ' String(m.lane.<0>()) + "," + String(m.lane.<2>());')).toBe('1,0');
  // and it consumes as a mask
  expect(evaluated(`const m: vector.<boolean1, 4> = ${C};`
    + ' String(m.select(int32x4(9, 9, 9, 9), int32x4(5, 5, 5, 5)).x);')).toBe('9');
});

test('adding the forms did not weaken the selection rules', () => {
  const C = 'int32x4(0, 1, 2, 3) == int32x4(0, 1, 3, 2)';
  // the wide mask still resolves
  expect(evaluated(`const m: boolean32x4 = ${C}; String(m.any());`)).toBe('true');
  // no expected type is still ambiguous among the three
  expectThrown(`const m = ${C};`);
  // and a type that is none of the three is still refused
  expectThrown(`const m: float64x2 = ${C};`);
});

// -- phase 4: negation and the lane-wise Math surface -------------------------
test('negation applies lane-wise and keeps the vector type', () => {
  expect(evaluated('const v = -float32x4(1, 2, 3, 4); String(v.x) + "," + String(v.w);')).toBe('-1,-4');
  expect(evaluated('const v = -int32x4(-1, 2, -3, 4); String(v.x) + "," + String(v.y);')).toBe('1,-2');
  // and the scalar operator is untouched
  expect(evaluated('String(-5) + "," + String(-(-5));')).toBe('-5,5');
});

/**
 * A Math function applies lane-wise to a vector, returning a vector of the
 * argument's shape. The exactly-specified functions give the scalar result for
 * each lane; the approximated ones are approximated independently of their
 * scalar forms, so a lane of `Math.sin(v)` need not equal the scalar
 * `Math.sin` of that lane.
 */
test('the exact Math functions apply lane-wise', () => {
  expect(evaluated('const v = Math.sqrt(float32x4(1, 4, 9, 16));'
    + ' String(v.x) + "," + String(v.y) + "," + String(v.z) + "," + String(v.w);')).toBe('1,2,3,4');
  expect(evaluated('const v = Math.abs(int32x4(-1, 2, -3, 4)); String(v.x) + "," + String(v.z);')).toBe('1,3');
  expect(evaluated('const v = Math.min(float32x4(1, 5, 3, 7), float32x4(4, 2, 6, 0));'
    + ' String(v.x) + "," + String(v.y) + "," + String(v.w);')).toBe('1,2,0');
  expect(evaluated('const v = Math.max(float32x4(1, 5, 3, 7), float32x4(4, 2, 6, 0));'
    + ' String(v.x) + "," + String(v.y);')).toBe('4,5');
  expect(evaluated('String(Math.floor(float32x4(1.7, 2, 3, 4)).x) + ","'
    + ' + String(Math.ceil(float32x4(1.1, 2, 3, 4)).x) + ","'
    + ' + String(Math.trunc(float32x4(-2.9, 2, 3, 4)).x);')).toBe('1,2,-2');
});

test('the approximated Math functions apply lane-wise too', () => {
  expect(evaluated('const v = Math.sin(float32x4(0, 0, 0, 0)); String(v.x);')).toBe('0');
  expect(evaluated('const v = Math.cos(float32x4(0, 0, 0, 0)); String(v.x);')).toBe('1');
  expect(evaluated('const v = Math.pow(float32x4(2, 3, 4, 5), float32x4(2, 2, 2, 2));'
    + ' String(v.x) + "," + String(v.y);')).toBe('4,9');
  expect(evaluated('String(Math.log(float32x4(1, 1, 1, 1)).x) + ","'
    + ' + String(Math.exp(float32x4(0, 0, 0, 0)).x);')).toBe('0,1');
});

test('a scalar beside a vector broadcasts, and shapes must agree', () => {
  expect(evaluated('const v = Math.min(float32x4(1, 5, 3, 7), 4); String(v.x) + "," + String(v.y);')).toBe('1,4');
  expectThrown('Math.min(float32x4(1, 2, 3, 4), float64x2(1, 2));');
  // the scalar functions are unaffected
  expect(evaluated('String(Math.sqrt(16)) + "," + String(Math.min(3, 5)) + "," + String(Math.sin(0));')).toBe('4,3,0');
});

// -- phase 5: 64-bit lanes ----------------------------------------------------
/**
 * A 64-bit lane holds a Number, as `int64` does: BigInt literals keep the `n`
 * suffix and stay `bigint`, and an unsuffixed literal reaches `int64` by
 * propagation, so `int64x2(1n, 2n)` is a type error and `int64x2(1, 2)` is the
 * spelling.
 *
 * Every negative value of an `int64` or `int128` was zero before this phase -
 * scalar and lane alike - because the reduction modulo 2**bits was done in
 * Number arithmetic, where `-5 + 2**64` rounds to exactly 2**64 and the
 * two's-complement step then subtracts it back to nothing.
 */
test('a 64-bit lane holds negative values', () => {
  expect(evaluated('const a: int64 = -5; String(a);')).toBe('-5');
  expect(evaluated('const a: int128 = -5; String(a);')).toBe('-5');
  expect(evaluated('String(int64x2(-5, 2).x);')).toBe('-5');
  expect(evaluated('const a: int64 = 3; const b: int64 = 10; String(a - b);')).toBe('-7');
  expect(evaluated('const v = -int64x2(1, 2); String(v.x);')).toBe('-1');
  expect(evaluated('String(Math.abs(int64x2(-5, 2)).x);')).toBe('5');
});

test('the operation surface works across 64-bit lanes', () => {
  expect(evaluated('const a = int64x2(10, 20); const b = int64x2(3, 4);'
    + ' String((a + b).x) + "," + String((a * b).y);')).toBe('13,80');
  expect(evaluated('String((uint64x2(6, 6) & uint64x2(3, 3)).x);')).toBe('2');
  expect(evaluated('String(int64x2(3, 4).sum());')).toBe('7');
  expect(evaluated('const a = int64x2(1, 2); String(a.lane.<1>()) + "," + String(a.withLane.<0>(9).x);')).toBe('2,9');
  expect(evaluated('const a = int64x2(1, 2); String(a.xy.y);')).toBe('2');
  expect(evaluated('const a = float64x2(1.5, 2.5); String((a + a).x) + ","'
    + ' + String(Math.sqrt(float64x2(4, 9)).y);')).toBe('3,3');
});

test('comparisons and masks work at 64 bits', () => {
  expect(evaluated('const m: boolean64x2 = int64x2(1, 5) < int64x2(3, 3);'
    + ' String(m.any()) + "," + String(m.all());')).toBe('true,false');
  // the all-ones form, which the wrapping defect turned into zeroes
  expect(evaluated('const v: int64x2 = int64x2(1, 5) < int64x2(3, 3);'
    + ' String(v.x) + "," + String(v.y);')).toBe('-1,0');
  expect(evaluated('const m: boolean64x2 = int64x2(1, 5) < int64x2(3, 3);'
    + ' String(m.select(int64x2(7, 7), int64x2(9, 9)).x);')).toBe('7');
});

test('a BigInt is not a 64-bit integer', () => {
  // "Cannot mix uint64 and bigint" - the families convert explicitly
  expectThrown('const a: int64 = 1n;');
  expectThrown('int64x2(1n, 2n);');
});
