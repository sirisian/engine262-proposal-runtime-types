import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * Spec: #sec-range-literals.
 *
 * > A range literal read at an element type _T_, where a contextual type gives
 * > it one, is a type error unless every element it produces is a value of _T_.
 *
 * The check is on the FIRST AND LAST ELEMENT, not the endpoints, because a
 * half-open range's end is never produced. `0..<256` yields every byte and must
 * fit `uint8`, though `256` does not. Each case is asserted at an annotated
 * binding, a parameter, and a return, which reach the rule by different routes.
 */

const at = (range: string, type = 'uint8', family = 'ClosedOpenRange') => [
  `let r: ${family}.<${type}> = ${range};`,
  `function f(r: ${family}.<${type}>) {} f(${range});`,
  `function g(): ${family}.<${type}> { return ${range}; }`,
];

test('a range whose elements are all values of the type fits', () => {
  for (const src of at('0..<256')) expect(ok(src)).toBe(true);
  for (const src of at('0..=255', 'uint8', 'ClosedRange')) expect(ok(src)).toBe(true);
  expect(ok('let r: Range.<uint8, Range.Bound.Open, Range.Bound.Closed> = 0<..=255;')).toBe(true);
  expect(ok('let r: Range.<uint8, Range.Bound.Open, Range.Bound.Open> = 0<..<256;')).toBe(true);
});

test('an EMPTY range fits any type', () => {
  // ranges.md: descending ranges "are empty, not reversed", and an open bound
  // at equal endpoints excludes the only value the range could hold.
  for (const src of at('10..<0')) expect(ok(src)).toBe(true);
  for (const src of at('5..<5')) expect(ok(src)).toBe(true);
});

test('a range producing a value outside the type is refused, naming it', () => {
  for (const src of at('0..=256', 'uint8', 'ClosedRange')) expectThrown(src, '256');
  for (const src of at('0..<257')) expectThrown(src, '256');
  for (const src of at('0..<300')) expectThrown(src, '299');
});

test('an unbounded or infinite end fits no bounded type', () => {
  expectThrown('let r: RangeFrom.<uint8, Range.Bound.Closed> = 0..;', 'no upper bound');
  expectThrown('let r: ClosedOpenRange.<uint8> = 0..<Infinity;', 'no upper bound');
});

test('types with no limit to exceed are unaffected', () => {
  expect(ok('let r: RangeFrom.<number, Range.Bound.Closed> = 0..;')).toBe(true);
  expect(ok('let r: ClosedOpenRange.<bigint> = 0n..<(2n ** 80n);')).toBe(true);
  // A float's elements are not a successor sequence; not judged by this rule.
  expect(ok('let r: ClosedOpenRange.<float32> = 0.5..<3;')).toBe(true);
});

test('an endpoint known only at run time is not decided here', () => {
  // A typed store of an element that does not fit is refused where it happens.
  expect(ok('let n = 300; let r: ClosedOpenRange.<uint8> = 0..<n;')).toBe(true);
});

/**
 * Follow-up B: an element type taken from a TYPED ENDPOINT rather than from
 * context. The typed endpoint's value is unknown, but its type bounds it, so the
 * rule judges the widest the range could reach: a literal start by the first
 * element, a literal end by the last. Reading the literal at the type instead
 * would refuse `s..<256`, whose 256 is the stop and never produced.
 */
test('a range typed by an endpoint produces only values of that type', () => {
  const s = (decl: string, range: string) => `function f() { ${decl} let r = ${range}; }`;
  const u8 = 'const s: uint8 = (5 := uint8); const e: uint8 = (5 := uint8);';
  expectThrown(s(u8, 's..<300'), '299');
  expectThrown(s(u8, 's..=256'), '256');
  expectThrown(s(u8, '-1..=e'), '-1');
  expectThrown(s('const s: int8 = (5 := int8);', 's..<200'), '199');
  expectThrown(s('const e: int8 = (5 := int8);', '-200..=e'), '-200');
  // An endpoint known only at run time is bounded by its type all the same.
  expectThrown('function f(s: uint8) { let r = s..<300; }', '299');
  // ...including where a contextual type fixes the element type.
  expectThrown('function f(s: uint8) { let r: ClosedOpenRange.<uint8> = s..<300; }', '299');
});

test('a typed-endpoint range that fits, or is always empty, is accepted', () => {
  const s = (decl: string, range: string) => `function f() { ${decl} let r = ${range}; }`;
  const u8 = 'const s: uint8 = (5 := uint8); const e: uint8 = (5 := uint8);';
  expect(ok(s(u8, 's..<256'))).toBe(true);
  expect(ok(s(u8, '0..=e'))).toBe(true);
  expect(ok(s(u8, '0..<e'))).toBe(true);
  // Empty for every value `e` can take, so it produces nothing false.
  expect(ok(s(u8, '300..=e'))).toBe(true);
  expect(ok(s(u8, 's..<0'))).toBe(true);
  // Both endpoints typed: sound by construction.
  expect(ok('function f(a: uint8, b: uint8) { let r = a..<b; }')).toBe(true);
});

/**
 * Follow-up A: a float element type. A range with whole-integer endpoints
 * iterates by 1 and yields the integer it steps to, rounding nothing - so each
 * element must be EXACTLY a value of the type. `float16` holds integers exactly
 * only to 2**11, `float32` to 2**24.
 */
test('an iterating float range must produce only exact values of its type', () => {
  expect(ok('let r: ClosedOpenRange.<float16> = 0..<2049;')).toBe(true);
  expect(ok('let r: ClosedRange.<float16> = -2048..=2048;')).toBe(true);
  // 2050 is representable in `float16`; 2049 is not.
  expect(ok('let r: ClosedOpenRange.<float16> = 2050..<2051;')).toBe(true);
  expectThrown('let r: ClosedOpenRange.<float16> = 2049..<2050;', '2049');
  expectThrown('let r: ClosedOpenRange.<float16> = 0..<4000;', '2049');
  // Precision fails long before overflow, so the first failure is named.
  expectThrown('let r: ClosedOpenRange.<float16> = 0..<100000;', '2049');
  expect(ok('let r: ClosedOpenRange.<float32> = 0..<16777217;')).toBe(true);
  expectThrown('let r: ClosedOpenRange.<float32> = 0..<16777218;', '16777217');
  expect(ok('let r: ClosedOpenRange.<float64> = 0..<1000;')).toBe(true);
});

test('a float interval refuses only an endpoint that overflows', () => {
  // Non-integer endpoints: no implicit step, so no elements to judge.
  expect(ok('let r: ClosedOpenRange.<float32> = 0.5..<3;')).toBe(true);
  // An endpoint that rounds is accepted, as `let x: float32 = 0.1` is.
  expect(ok('let r: ClosedOpenRange.<float32> = 0.1..<0.9;')).toBe(true);
  expectThrown('let r: ClosedOpenRange.<float32> = 0.5..<1e39;', 'overflows');
  expectThrown('let r: ClosedOpenRange.<float16> = 0.5..<70000.5;', 'overflows');
});
