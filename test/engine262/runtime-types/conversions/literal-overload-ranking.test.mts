import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * #sec-literal-overload-ranking, which states the case this file tests:
 *
 *   "The ranking is the only place the order of the numeric types matters, and
 *    it matters only for a literal. Given `f(a: float32)` and `f(a: uint32)`,
 *    the call `f(1)` selects the `float32` signature."
 *
 * The engine reported that call as ambiguous. `Tier.Literal` already existed and
 * cited the clause by name - an untyped literal can take either parameter's type,
 * so both signatures scored it and the tiers tied - but the ranking that breaks
 * that tie was never implemented.
 *
 * Found by running the design documents' examples: `README.md:1004` is the
 * clause's example, written out, and it failed.
 */

const two = (a: string, b: string) => `function f(x: ${a}) { return "A"; } function f(x: ${b}) { return "B"; } f(1);`;

test('a lower rank wins', () => {
  // 1 float64 | 2 float128 float32 float16 | 3 decimal | 4 uint | 5 int
  expect(evaluated(two('float32', 'uint32'))).toBe('A');
  expect(evaluated(two('float64', 'uint32'))).toBe('A');
  expect(evaluated(two('uint32', 'int32'))).toBe('A');
  expect(evaluated(two('float64', 'float32'))).toBe('A');
  // ...and the order does not depend on which is written first.
  expect(evaluated(two('uint32', 'float32'))).toBe('B');
});

test('a rank orders its widths, widest first', () => {
  // This asserted the opposite - that a rank is a set, "the clause orders the
  // FAMILIES, not the widths within one, so a fix that resolved these would have
  // invented an order". #table-literal-ranking-completion settles it the other
  // way, and in as many words: `int.<N>` and `uint.<N>` rank "among the widths of
  // their family, in the same order: a narrower width after a wider one.
  // `uint.<24>` ranks after `uint32` and before `uint16`." Placing `uint.<24>`
  // BETWEEN two named widths says nothing unless those two are ordered.
  //
  // The main table agrees once read closely: its column is headed "Types, in
  // order", and the preamble takes "the FIRST that can represent the literal",
  // which a set has none of.
  expect(evaluated(two('float32', 'float16'))).toBe('A');
  expect(evaluated(two('uint32', 'uint8'))).toBe('A');
  // Both directions, so this is the ORDER and not the written position.
  expect(evaluated(two('float16', 'float128'))).toBe('B');
  expect(evaluated(two('uint8', 'uint128'))).toBe('B');
  expect(evaluated(two('decimal32', 'decimal128'))).toBe('B');
});

test('the completion table places the widths the main table omits', () => {
  // #table-literal-ranking-completion: `int.<N>` and `uint.<N>` at a width that
  // is not a named shorthand rank "among the widths of their family, in the same
  // order: a narrower width after a wider one. `uint.<24>` ranks after `uint32`
  // and before `uint16`." Both halves of that sentence, which is what pins the
  // placement to the WIDTH rather than to a list of the five names.
  expect(evaluated(two('uint32', 'uint.<24>'))).toBe('A');
  expect(evaluated(two('uint.<24>', 'uint16'))).toBe('A');
  // And a rational ranks "after every integer type".
  expect(evaluated(two('uint8', 'rational'))).toBe('A');
  expect(evaluated(two('int8', 'rational'))).toBe('A');
  // Without displacing the families above it.
  expect(evaluated(two('float64', 'rational'))).toBe('A');
  expect(evaluated(two('decimal64', 'rational'))).toBe('A');
});

test('an omitted width is ranked by the completion table, not left unranked', () => {
  // This read the main table's omission - it "omits the rational types and the
  // parameterized widths `int.<N>` and `uint.<N>` for an N that is not a named
  // shorthand" - as leaving those types unranked, so the tie stood "rather than
  // being decided by a rule the proposal has not written".
  //
  // The rule IS written, one clause away: #table-literal-ranking-completion
  // exists precisely for "the types it omits, which are the ones a call may
  // nonetheless select", and gives every one of them a place. `uint.<7>` is
  // narrower than `uint8`, so it ranks after it.
  expect(evaluated(two('uint.<7>', 'uint8'))).toBe('B');
  expect(evaluated(two('uint8', 'uint.<7>'))).toBe('A');
});

test('a TYPED argument is unaffected', () => {
  // The ranking is for an argument with no type of its own. One that has a type
  // selects by that type, and did so before this fix.
  expect(evaluated('function f(x: float32) { return "A"; } function f(x: uint32) { return "B"; } f(uint32(1));')).toBe('B');
});
