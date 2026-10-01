import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-array-and-tuple-types and #sec-typed-storage: a fixed shape's length never
// changes and typed storage cannot be deleted, so a length comparison or a
// constant-key `in` that they settle can never succeed or never fail
// (#sec-narrowfrom), and one that splits a union narrows it.

test.each([
  "function f(t: [uint8, uint8]) { if (t.length === 3) {} }",
  "function f(t: [uint8, uint8]) { if (t.length !== 2) {} }",
  "function f(a: [3].<uint8>) { if (a.length === 4) {} }",
  "function f(t: [uint8, uint8]) { if (2 in t) {} }",
  "function f(t: [uint8, uint8]) { if (0 in t) {} }",
  "class C { x: uint8 = 1; } function f(c: C) { if ('x' in c) {} }",
])("a test presence settles is refused: %s", expectStaticTypeError);

test.each([
  "function f(t: [uint8, ...[].<uint8>]) { if (t.length === 2) {} } 'ok';",
  "class C { x: uint8 = 1; } function f(c: C) { if ('y' in c) {} } 'ok';",
  "function f(t: [uint8] | [uint8, uint8]) { if (t.length === 2) { let p: [uint8, uint8] = t; } } 'ok';",
  "function f(o: { x: uint8 }) { if ('x' in o) {} } 'ok';",
])("a test presence leaves open is accepted: %s", (source) => expect(ok(source)).toBe(true));
