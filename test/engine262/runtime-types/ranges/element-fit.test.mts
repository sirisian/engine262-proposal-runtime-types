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
