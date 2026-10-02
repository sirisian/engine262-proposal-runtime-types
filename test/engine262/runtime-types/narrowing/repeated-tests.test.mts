import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowing-flow: a test over bindings with no effects records its outcome on
// each edge, so the same test before any write to those bindings is decided.

test.each([
  "function f(a: uint8, b: uint8) { if (a < b) { return 1; } else if (a < b) { return 2; } return 3; }",
  "function f(a: boolean, b: boolean) { if (a && b) { return 1; } else if (a && b) { return 2; } return 3; }",
  "function f(x: uint8, a: uint8) { switch (x) { case a: return 1; case a: return 2; } return 0; }",
])("a repeated test is refused: %s", expectStaticTypeError);

test.each([
  "function f(a: uint8, b: uint8) { if (a < b) { return 1; } a = b; if (a < b) { return 2; } return 3; } 'ok';",
  "function f(a: uint8, b: uint8) { const h = () => { a = 0; }; if (a < b) { return 1; } h(); if (a < b) { return 2; } return 3; } 'ok';",
  "function f(x: uint8, a: uint8, b: uint8) { switch (x) { case a: return 1; case b: return 2; } return 0; } 'ok';",
])("a test repeated after a write is accepted: %s", (source) => expect(ok(source)).toBe(true));
