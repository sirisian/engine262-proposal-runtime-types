import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowfrom: a fixed shape's `length` is its exact length wherever a test
// reads it, in a relational comparison, a truthiness test, a `case` label or a
// comparison of two lengths (#sec-array-and-tuple-types).

test.each([
  "function f(t: [uint8, uint8]) { if (t.length < 2) {} }",
  "function f(t: [uint8, uint8]) { if (t.length >= 2) {} }",
  "function f(t: [uint8, uint8]) { if (t.length) {} }",
  "function f(a: [0].<uint8>) { if (a.length) {} }",
  "function f(t: [uint8, uint8]) { switch (t.length) { case 3: return 1; } return 0; }",
  "function f(t: [uint8, uint8], u: [uint8, uint8, uint8]) { if (t.length === u.length) {} }",
])("a length test the exact length settles is refused: %s", expectStaticTypeError);

test.each([
  "function f(a: [].<uint8>) { if (a.length < 3) {} if (a.length) {} } 'ok';",
  "function f(t: [uint8] | [uint8, uint8]) { if (t.length < 2) {} } 'ok';",
  "function f(t: [uint8, uint8]) { switch (t.length) { case 2: return 1; } return 0; } 'ok';",
])("a length test left open is accepted: %s", (source) => expect(ok(source)).toBe(true));
