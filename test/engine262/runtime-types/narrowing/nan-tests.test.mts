import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowfrom: equality with NaN can never succeed, a path compared with itself
// can never fail where its type holds no NaN, and a numeric predicate whose answer
// #table-numeric-predicates fixes for the argument's family returns that answer
// (#sec-numeric-predicates). Operands that do not participate are unaffected.

test.each([
  "function f(x: float64) { if (x === NaN) {} }",
  "function f(x: float64) { switch (x) { case NaN: return 1; } return 0; }",
  "function f(x: uint8) { if (x === x) {} }",
  "function f(x: uint8) { if (x !== x) {} }",
  "function f(x: uint8) { if (Number.isNaN(x)) {} }",
  "function f(x: uint8) { if (isNaN(x)) {} }",
  "function f(x: uint8) { if (Number.isFinite(x)) {} }",
  "function f(x: uint8) { if (Number.isInteger(x)) {} }",
  "function f(x: int32) { if (Number.isSafeInteger(x)) {} }",
  "function f(o: { a: uint8 }) { if (o === o) {} }",
])("a comparison NaN settles is refused: %s", expectStaticTypeError);

test.each([
  "function f(x: float64) { if (x !== x) {} if (Number.isNaN(x)) {} } 'ok';",
  "function f(x: float64) { let r = x === NaN; return r; } 'ok';",
  "let a = 1; if (a === NaN) {} 'ok';",
  "function f(x: int64) { if (Number.isSafeInteger(x)) {} } 'ok';",
  "function f(NaN: uint8, x: uint8) { if (x === NaN) {} } 'ok';",
])("a comparison NaN leaves open is accepted: %s", (source) => expect(ok(source)).toBe(true));
