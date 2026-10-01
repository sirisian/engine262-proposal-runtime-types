import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-proved-library-operations: `Array.isArray`, and a `Number` static given a
// non-Number, answer by the argument's type, so a test of one it settles is
// refused (#sec-narrowfrom).

test.each([
  "function f(s: string) { if (Array.isArray(s)) {} }",
  "function f(t: [uint8, uint8]) { if (Array.isArray(t)) {} }",
  "function f(s: string) { if (Number.isInteger(s)) {} }",
])("a library test the types settle is refused: %s", expectStaticTypeError);

test.each([
  "function f(x: float64) { if (Object.is(x, NaN)) {} } 'ok';",
  "function f(x: uint8, y: uint8 | null) { return Object.is(x, y); } 'ok';",
  "function f(x: string | [].<uint8>) { if (Array.isArray(x)) {} } 'ok';",
  "function f(s: string) { let r = Number.isInteger(s); return r; } 'ok';",
])("a library call the types leave open is accepted: %s", (source) => expect(ok(source)).toBe(true));
