import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowfrom: a relational comparison of a numeric operand with a constant
// can never succeed where no value of the operand's type satisfies it, and never
// fail where every value does; NaN satisfies no comparison, so a float operand is
// judged only in the first direction. A constant answer in a value position stays legal.

test.each([
  "function f(x: uint8) { if (x < 0) {} }",
  "function f(x: uint8) { if (x >= 0) {} }",
  "function f(x: uint8) { if (0 > x) {} }",
  "function f(x: int8) { if (x > 127) {} }",
  "function f(x: uint16) { if (x <= 65535) {} }",
  "function f(x: float64) { if (x < -Infinity) {} }",
  "function f(x: uint8) { return x >= 0 ? 1 : 2; }",
  "function f(x: uint8) { switch (true) { case x < 0: return 1; } return 0; }",
  "function f(x: uint8) { let i: uint8 = x; while (i >= 0) { i = i - 1; if (i === 3) break; } }",
  "function f(x: int8) { if (x >= -128 && x < 0) {} }",
])("a comparison the type's limits settle is refused: %s", expectStaticTypeError);

test.each([
  "function f(x: uint8) { let ok = x >= 0; return ok; } 'ok';",
  "function f(x: uint8) { if (x < 10) {} if (x > 0) {} if (x <= 254) {} } 'ok';",
  "function f(x: float64) { if (x <= Infinity) {} if (x >= -Infinity) {} if (x > 0) {} } 'ok';",
  "function f(x: int8) { if (x >= -100 && x < 0) {} } 'ok';",
])("a comparison the limits leave open is accepted: %s", (source) => expect(ok(source)).toBe(true));
