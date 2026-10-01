import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #table-static-type-base: `typeof v` has the literal type of each tag its
// operand's members can produce, `typeof` being unchanged (#sec-reflect-typeof),
// so two `typeof` results whose tags settle the comparison are refused.

test.each([
  "function f(x: string, y: uint8) { if (typeof x === typeof y) {} }",
  "function f(x: string, y: string) { if (typeof x !== typeof y) {} }",
])("a typeof comparison the tags settle is refused: %s", expectStaticTypeError);

test.each([
  "function f(x: uint8 | string, y: string) { if (typeof x === typeof y) {} } 'ok';",
  "function f(x: string) { let t: string = typeof x; let u: 'string' = typeof x; } 'ok';",
  "function f(x: uint8 | string) { if (typeof x === 'number') {} } 'ok';",
])("a typeof result the tags leave open is accepted: %s", (source) => expect(ok(source)).toBe(true));
