import { test, expect } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-pattern-static-semantics: a range pattern whose interval holds no value of its
// position can never match, and one holding every value of an integer position can
// never fail (#sec-narrowfrom). An empty interval matches nothing (#sec-range-literals).

test.each([
  "function f(x: uint8) { if (x is 300..<400) {} }",
  "function f(x: uint8) { if (x is -10..<0) {} }",
  "function f(x: int8) { if (x is 200..=300) {} }",
  "function f(x: float32) { if (x is 5..<5) {} }",
  "function f(x: uint8) { if (x is 0..=255) {} else {} }",
  "function f(x: uint8) { return match (x) { when 300..<400: 1; default: 2; }; }",
  "function f(x: uint8) { if (x is 0..<256) {} }",
])("a dead range test is refused: %s", expectStaticTypeError);

test.each([
  "function f(x: uint8) { if (x is 200..<300) {} if (x is 0..=254) {} return match (x) { when 0..<256: 1; }; } 'ok';",
  "function f(x: float32) { if (x is 0..) {} } 'ok';",
])("a live range test is accepted: %s", (source) => expect(ok(source)).toBe(true));
