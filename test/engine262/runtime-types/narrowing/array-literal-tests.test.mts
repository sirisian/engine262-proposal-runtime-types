import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowfrom: an array literal is always truthy and never nullish, including
// one #sec-static-iteration-contribution leaves without a Static Type.

test.each([
  "if ([]) {}",
  "function f() { while ([]) { break; } }",
  "function f() { return [] || 0; }",
  "function f() { return [] ?? 1; }",
])("a test of an array literal is refused: %s", expectStaticTypeError);

test.each([
  "function f() { let a = [] && 1; return a; } 'ok';",
])("an array literal in a value position is accepted: %s", (source) => expect(ok(source)).toBe(true));
