import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

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

// -- phase 6: lane-type conversion --------------------------------------------
/**
 * A vector converts to another vector of the same lane COUNT by converting each
 * lane - the target's `cvtdq2ps` and `f32x4.convert_i32x4_s`.
 *
 * The scalar rule decides the spelling rather than a preference: an implicit
 * `const b: float32 = someInt32` is refused and `(a := float32)` converts, so a
 * vector does the same. No lane-type conversion happens silently.
 */
test('a vector converts lane-wise through an explicit conversion', () => {
  expect(evaluated('const f = (int32x4(1, 2, 3, 4) := float32x4);'
    + ' String(f.x) + "," + String(f.w);')).toBe('1,4');
  // the result really carries the target lane type
  expect(evaluated('const f = (int32x4(1, 2, 3, 4) := float32x4); String(f.x is float32);')).toBe('true');
  // float to integer truncates, as the scalar conversion does
  expect(evaluated('const i = (float32x4(1.7, 2.9, 3, 4) := int32x4);'
    + ' String(i.x) + "," + String(i.y);')).toBe('1,2');
  expect(evaluated('const v = (float64x2(1.9, 2.1) := int64x2); String(v.x);')).toBe('1');
  // signed to unsigned wraps, as the scalar conversion does
  expect(evaluated('const v = (int32x4(-1, 2, 3, 4) := uint32x4); String(v.x);')).toBe('4294967295');
});

test('conversion does not happen silently, and does not change the lane count', () => {
  // an implicit boundary refuses, exactly as it does for a scalar
  expectThrown('const f: float32x4 = int32x4(1, 2, 3, 4);');
  // changing the lane count is packing or unpacking, a different operation
  expectThrown('uint8x16(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16) := int32x4;');
  // converting to the same type is the identity
  expect(evaluated('const f = (float32x4(1, 2, 3, 4) := float32x4); String(f.x);')).toBe('1');
});

test('the mask conversions are unaffected', () => {
  expect(evaluated('const m: boolean32x4 = float32x4(1, 2, 3, 4) < float32x4(4, 3, 2, 1);'
    + ' String(m.any());')).toBe('true');
  expect(evaluated('const m: vector.<boolean1, 4> = int32x4(1, 2, 3, 4) == int32x4(1, 9, 9, 9);'
    + ' String(m.any());')).toBe('true');
});

// -- phase 7: masked operations as inputs -------------------------------------
/**
 * Intel's masking is not only a RESULT form: nearly every arithmetic intrinsic
 * has a write-masked variant, whose untaken lanes are blended from a source, and
 * a zero-masked one, whose untaken lanes are zeroed. `select` over the operation
 * already denotes both, so no syntax is added; an implementation may lower the
 * composition to one predicated instruction, and the bound on that permission is
 * purity, which the last test here pins.
 */
test('select over an operation is the write-masked and zero-masked form', () => {
  // lanes 0 and 1 set, lanes 2 and 3 clear
  const M = 'const a = int32x4(10, 20, 30, 40); const b = int32x4(1, 2, 3, 4);'
    + ' const m: boolean32x4 = int32x4(1, 1, 9, 9) < int32x4(5, 5, 0, 0); ';
  const all4 = (e: string) => `const s = ${e};`
    + ' String(s.x) + "," + String(s.y) + "," + String(s.z) + "," + String(s.w);';
  // write-masked: _mm512_mask_add_epi32(a, k, a, b)
  expect(evaluated(M + all4('m.select(a + b, a)'))).toBe('11,22,30,40');
  // zero-masked: _mm512_maskz_add_epi32(k, a, b)
  expect(evaluated(`${M}const zero = int32x4(0, 0, 0, 0); ${all4('m.select(a + b, zero)')}`)).toBe('11,22,0,0');
  // and the same shape over the other operators
  expect(evaluated(M + all4('m.select(a - b, a)'))).toBe('9,18,30,40');
  expect(evaluated(M + all4('m.select(a * b, a)'))).toBe('10,40,30,40');
  expect(evaluated(M + all4('m.select(a & b, a)'))).toBe('0,0,30,40');
  expect(evaluated(`${M}const zero = int32x4(0, 0, 0, 0); ${all4('m.select(a << b, zero)')}`)).toBe('20,80,0,0');
});

test('a degenerate mask gives the unmasked and the untouched result', () => {
  const A = 'const a = int32x4(10, 20, 30, 40); const b = int32x4(1, 2, 3, 4); ';
  const all4 = (e: string) => `const s = ${e};`
    + ' String(s.x) + "," + String(s.y) + "," + String(s.z) + "," + String(s.w);';
  expect(evaluated(`${A}const m: boolean32x4 = int32x4(1, 1, 1, 1) < int32x4(5, 5, 5, 5); `
    + all4('m.select(a + b, a)'))).toBe('11,22,33,44');
  expect(evaluated(`${A}const m: boolean32x4 = int32x4(9, 9, 9, 9) < int32x4(5, 5, 5, 5); `
    + all4('m.select(a + b, a)'))).toBe('10,20,30,40');
});

test('masked operations compose, and both arms are still evaluated', () => {
  const M = 'const a = int32x4(10, 20, 30, 40); const b = int32x4(1, 2, 3, 4);'
    + ' const m: boolean32x4 = int32x4(1, 1, 9, 9) < int32x4(5, 5, 0, 0); ';
  // a masked result feeding another masked operation
  expect(evaluated(`${M}const s = m.select(m.select(a + b, a) * b, a);`
    + ' String(s.x) + "," + String(s.y) + "," + String(s.z);')).toBe('11,44,30');
  // a lane-wise Math call as the arm
  expect(evaluated('const a = float32x4(1, 4, 9, 16);'
    + ' const m: boolean32x4 = float32x4(1, 1, 9, 9) < float32x4(5, 5, 0, 0);'
    + ' const s = m.select(Math.sqrt(a), a); String(s.x) + "," + String(s.z);')).toBe('1,9');
  // select is an ordinary call, so an argument that runs user code runs whatever
  // the mask holds - this is the bound on eliding an arm's computation
  expect(evaluated("let log = ''; function f(t) { log += t; return int32x4(1, 1, 1, 1); }"
    + ' const m: boolean32x4 = int32x4(1, 9, 9, 9) < int32x4(5, 0, 0, 0);'
    + " m.select(f('set'), f('clear')); log;")).toBe('setclear');
});

// -- phase 8: the designed-but-unimplemented surface ---------------------------
/**
 * `README.md` states the checked and saturating forms are "overloaded for every
 * integer type", and an integer-lane vector is one. The scalar forms worked;
 * the vector forms were refused, because these were registered without the
 * wrapper that carries the lane-wise dispatch.
 */
test('the checked and saturating forms apply lane-wise', () => {
  const U = 'const a = uint8x16(255, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);'
    + ' const b = uint8x16(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1); ';
  // lane 0 saturates at the maximum, lane 1 is an ordinary sum
  expect(evaluated(`${U}String(Math.addSaturating(a, b).lane.<0>());`)).toBe('255');
  expect(evaluated(`${U}String(Math.addSaturating(a, b).lane.<1>());`)).toBe('2');
  expect(evaluated('const a = uint8x16(0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5);'
    + ' const b = uint8x16(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);'
    + ' String(Math.subSaturating(a, b).lane.<0>());')).toBe('0');
  expect(evaluated('const a = int32x4(2147483647, 1, 1, 1); const b = int32x4(1, 1, 1, 1);'
    + ' String(Math.addSaturating(a, b).x);')).toBe('2147483647');
  // the checked form raises where a lane cannot hold the result, and division
  // truncates toward zero exactly as `/` does
  expectThrown(`${U}Math.addChecked(a, b);`);
  expect(evaluated('const a = int32x4(7, 9, 11, 13); const b = int32x4(2, 2, 2, 2);'
    + ' String(Math.divChecked(a, b).x);')).toBe('3');
  expectThrown('const a = int32x4(1, 1, 1, 1); const z = int32x4(0, 0, 0, 0); Math.divChecked(a, z);');
  // the scalar forms are unchanged
  expect(evaluated('const a: uint8 = 255; String(Math.addSaturating(a, 1));')).toBe('255');
});

/**
 * `operatoroverloading.md`: "`Math.fma(a, b, c)` computes `a * b + c` with a
 * single rounding. It is overloaded for the scalar and vector types."
 *
 * The single rounding is the whole of it: computing `a * b` and then adding
 * rounds twice and is a different function. The two cases below are ones where
 * the answers differ, so an implementation that shimmed over `*` and `+` would
 * fail them; the expected values are the exactly-computed ones.
 */
test('Math.fma rounds once', () => {
  expect(evaluated('String(Math.fma(2, 3, 4));')).toBe('10');
  expect(evaluated('String(Math.fma(-2, 3, 1));')).toBe('-5');
  // a * b is not representable, so the double rounding loses the difference
  expect(evaluated('String(Math.fma(1e16, 1e16, -1e32));')).toBe('-5366162204393472');
  expect(evaluated('String(1e16 * 1e16 - 1e32);')).toBe('0');
  expect(evaluated('String(Math.fma(1.0000000000000002, 3, -3));')).toBe('6.661338147750939e-16');
  expect(evaluated('String(1.0000000000000002 * 3 - 3);')).toBe('8.881784197001252e-16');
  // the non-finite cases agree with the ordinary operators, no rounding occurring
  expect(evaluated('String(Math.fma(NaN, 1, 1));')).toBe('NaN');
  expect(evaluated('String(Math.fma(Infinity, 1, 1));')).toBe('Infinity');
  // and the vector half comes from the lane-wise dispatch
  expect(evaluated('String(Math.fma(float32x4(2, 2, 2, 2), float32x4(3, 3, 3, 3),'
    + ' float32x4(4, 4, 4, 4)).x);')).toBe('10');
});

/**
 * `operatoroverloading.md`: "`Math.rsqrt(x)` is exactly `1 / Math.sqrt(x)`,
 * correctly rounded, so it does not lower to a bare `rsqrtps`, which is a
 * twelve-bit approximation."
 *
 * CORRECTLY ROUNDED is stronger than evaluating `1 / Math.sqrt(x)` in doubles,
 * which rounds twice and differs for roughly a quarter of inputs. The values
 * below are the exactly-computed ones, and four of them are cases where the
 * naive form gives a different double - so an implementation that shimmed over
 * `1 / Math.sqrt(x)`, or reached for the approximate instruction, fails here.
 */
test('Math.rsqrt is correctly rounded', () => {
  expect(evaluated('String(Math.rsqrt(4));')).toBe('0.5');
  // these four differ from `1 / Math.sqrt(x)`
  expect(evaluated('String(Math.rsqrt(2));')).toBe('0.7071067811865476');
  expect(evaluated('String(Math.rsqrt(0.5));')).toBe('1.4142135623730951');
  expect(evaluated('String(Math.rsqrt(3));')).toBe('0.5773502691896257');
  expect(evaluated('String(Math.rsqrt(7));')).toBe('0.37796447300922725');
  // and the naive form is visibly not the same function
  expect(evaluated('String(1 / Math.sqrt(2));')).toBe('0.7071067811865475');
  // extremes stay exact rather than overflowing through the intermediate
  expect(evaluated('String(Math.rsqrt(1e300)) + "," + String(Math.rsqrt(1e-300));')).toBe('1e-150,1e+150');
});

test('Math.rsqrt at the boundary values', () => {
  // 1/sqrt(x) at a zero: sqrt(-0) is -0, so the reciprocal keeps the sign
  expect(evaluated('String(Math.rsqrt(0));')).toBe('Infinity');
  expect(evaluated('String(Math.rsqrt(-0));')).toBe('-Infinity');
  expect(evaluated('String(Math.rsqrt(-1));')).toBe('NaN');
  expect(evaluated('String(Math.rsqrt(NaN));')).toBe('NaN');
  expect(evaluated('String(Math.rsqrt(Infinity));')).toBe('0');
  // and the vector half comes from the lane-wise dispatch
  expect(evaluated('String(Math.rsqrt(float32x4(4, 16, 64, 256)).x);')).toBe('0.5');
});

// -- phase 8d: the remaining integer and reduction operations ------------------
/**
 * Each is one instruction on every target and each was absent. `Math.clz` was
 * already here and specified; these are its neighbours, and like it they take
 * their width from the operand's type and so have no untyped signature.
 */
test('the integer bit and widening operations', () => {
  expect(evaluated('String(Math.popcount((7 := uint8)));')).toBe('3');
  expect(evaluated('String(Math.popcount((255 := uint8)));')).toBe('8');
  // a signed value counts the bits of its two's-complement representation
  expect(evaluated('String(Math.popcount((-1 := int8)));')).toBe('8');
  // the width is the whole of its meaning, so a plain Number has no signature
  expectThrown('Math.popcount(7);');
  // the half of the product an ordinary multiply discards
  expect(evaluated('String(Math.mulHigh((65535 := uint16), (65535 := uint16)));')).toBe('65534');
  expect(evaluated('String(Math.mulHigh((-32768 := int16), (2 := int16)));')).toBe('-1');
  // rounded away from zero, as pavgb rounds, and summed without overflowing
  expect(evaluated('String(Math.average((255 := uint8), (255 := uint8)));')).toBe('255');
  expect(evaluated('String(Math.average((1 := uint8), (2 := uint8)));')).toBe('2');
});

test('the integer operations apply lane-wise too', () => {
  expect(evaluated('String(Math.popcount(uint8x16(7, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)).lane.<0>());')).toBe('3');
  expect(evaluated('String(Math.mulHigh(uint16x8(65535, 1, 1, 1, 1, 1, 1, 1),'
    + ' uint16x8(65535, 1, 1, 1, 1, 1, 1, 1)).lane.<0>());')).toBe('65534');
  expect(evaluated('String(Math.average(uint8x16(255, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1),'
    + ' uint8x16(255, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)).lane.<0>());')).toBe('255');
});

test('the dot product is a reduction over two vectors', () => {
  // a reduction, so it belongs on the vector as `sum` does rather than on Math
  expect(evaluated('String(float32x4(1, 2, 3, 4).dot(float32x4(1, 1, 1, 1)));')).toBe('10');
  expect(evaluated('String(int32x4(1, 2, 3, 4).dot(int32x4(2, 2, 2, 2)));')).toBe('20');
  expectThrown('float32x4(1, 2, 3, 4).dot(float64x2(1, 1));');
  expect(evaluated('String(float32x4(1, 2, 3, 4).sum());')).toBe('10');
});

test('the approximate reciprocal square root carries a stated bound', () => {
  // the design asked for "a named intrinsic and a specified error bound": the
  // bound is a relative error of at most 2**-12, which rsqrtps and frsqrte both
  // meet. Any value within it conforms; this implementation returns the
  // correctly rounded one, which is within it trivially.
  expect(evaluated('String(Math.rsqrtApprox(4));')).toBe('0.5');
  expect(evaluated('const r = Math.rsqrtApprox(2);'
    + ' String(Math.abs(r - Math.rsqrt(2)) / Math.rsqrt(2) <= Math.pow(2, -12));')).toBe('true');
  expect(evaluated('String(Math.rsqrtApprox(float32x4(4, 16, 64, 256)).x);')).toBe('0.5');
});
