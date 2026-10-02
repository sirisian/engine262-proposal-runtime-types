import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowfrom: an array literal is always truthy and never nullish, including
// one #sec-static-iteration-contribution leaves without a Static Type.

test.each([
  "function f(p: number) { if ([]) {} }",
  "function f(p: number) { while ([]) { break; } }",
  "function f(p: number) { return [] || 0; }",
  "function f(p: number) { return [] ?? 1; }",
])("a test of an array literal is refused: %s", expectStaticTypeError);

// #sec-checked-code: the same tests in code using none of the proposal's syntax
// keep their behaviour.
test.each([
  "if ([]) {} 'ok';",
  "function f() { while ([]) { break; } } 'ok';",
  "function f() { return [] || 0; } 'ok';",
  "function f() { return [] ?? 1; } 'ok';",
])("outside checked code, a test of an array literal is accepted: %s", (source) => expect(ok(source)).toBe(true));

test.each([
  "function f() { let a = [] && 1; return a; } 'ok';",
])("an array literal in a value position is accepted: %s", (source) => expect(ok(source)).toBe(true));
