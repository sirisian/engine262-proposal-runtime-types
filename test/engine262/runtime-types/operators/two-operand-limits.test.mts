import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowfrom: a relational comparison reads both operands' limits, a
// compile-time constant, a BigInt literal, an enumerator member or constant
// arithmetic, contributing its value.

test.each([
  "enum P { Low = 1, High = 3 } function f(p: P) { if (p < P.Low) {} }",
  "function f(x: uint64) { if (x < 0n) {} }",
  "const K = 3; function f(x: uint8) { if (x > K * 100) {} }",
  "function f(x: uint8, y: 0) { if (x < y) {} }",
])("a comparison the limits settle is refused: %s", expectStaticTypeError);

test.each([
  "enum P { Low = 1, High = 3 } function f(p: P) { if (p < P.High) {} } 'ok';",
  "function f(x: uint8, y: uint8) { if (x < y) {} } 'ok';",
])("a comparison the limits leave open is accepted: %s", (source) => expect(ok(source)).toBe(true));
