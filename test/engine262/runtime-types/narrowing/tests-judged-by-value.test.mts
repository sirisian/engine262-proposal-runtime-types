import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowfrom: a test is judged by its value's Static Type whatever its form,
// a conditional by its whole type and an assignment by the value it stores; the
// literal idioms stay exempt.

test.each([
  "function f(x: uint8) { while (void x) { break; } }",
  "function f() { if (void 0) { return 1; } return 0; }",
  "function f(x: uint8) { if (typeof x) {} else { return 1; } return 0; }",
  "function f(x: object | null) { if (x = null) { return 1; } return 0; }",
  "function f(c: boolean) { if (c ? 1 : 2) {} }",
])("a test whose value settles it is refused: %s", expectStaticTypeError);

test.each([
  "function f(c: boolean, s: string) { if (c ? 'a' : s) {} } 'ok';",
  "function f(c: boolean) { if (c ? 'a' : '') {} } 'ok';",
  "function f(a: uint8, b: uint8) { if (a + b) {} } 'ok';",
  "function f(a: uint8) { if ('x' + a) {} } 'ok';",
  "function f() { while (true) { break; } if (0) {} } 'ok';",
])("a test whose value varies is accepted: %s", (source) => expect(ok(source)).toBe(true));
