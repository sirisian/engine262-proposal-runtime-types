import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowfrom: an enum's limits are its least and greatest enumerator values,
// and a strict equality of two operands whose closed sets share no value can
// never succeed.

test.each([
  "enum P { Low = 1, High = 3 } function f(p: P) { if (p < 1) {} }",
  "enum P { Low = 1, High = 3 } function f(p: P) { if (p >= 1) {} }",
  "enum A { X = 1, Y = 2 } enum B { Z = 3, W = 4 } function f(a: A, b: B) { if (a === b) {} }",
  "enum A { X = 1, Y = 2 } function f(a: A, n: 3 | 4) { if (a === n) {} }",
])("a comparison a closed set settles is refused: %s", expectStaticTypeError);

test.each([
  "enum P { Low = 1, High = 3 } function f(p: P) { if (p < 3) {} } 'ok';",
  "enum A { X = 1, Y = 2 } enum B { Z = 2, W = 3 } function f(a: A, b: B) { if (a === b) {} } 'ok';",
])("a comparison a closed set leaves open is accepted: %s", (source) => expect(ok(source)).toBe(true));
