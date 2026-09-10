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

test('the same rank stays ambiguous', () => {
  // The controls. `float32` and `float16` are both rank 2, `uint32` and `uint8`
  // both rank 4: the clause orders the FAMILIES, not the widths within one, so a
  // fix that resolved these would have invented an order.
  expectThrown(two('float32', 'float16'), 'ambiguous');
  expectThrown(two('uint32', 'uint8'), 'ambiguous');
});

test('a type the clause does not rank breaks no tie', () => {
  // The clause records its own omission: it "omits the rational types and the
  // parameterized widths `int.<N>` and `uint.<N>` for an N that is not a named
  // shorthand". `uint.<7>` is legal and unranked, so the tie stands rather than
  // being decided by a rule the proposal has not written.
  expectThrown(two('uint.<7>', 'uint8'), 'ambiguous');
});

test('a TYPED argument is unaffected', () => {
  // The ranking is for an argument with no type of its own. One that has a type
  // selects by that type, and did so before this fix.
  expect(evaluated('function f(x: float32) { return "A"; } function f(x: uint32) { return "B"; } f(uint32(1));')).toBe('B');
});
