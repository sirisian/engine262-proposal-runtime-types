import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowfrom: the empty String is the least String, and a union of literal
// String types has a least and a greatest member, so a comparison with a String
// constant they settle is refused where it decides a branch.

test.each([
  "function f(s: string) { if (s < '') {} }",
  "function f(s: string) { if (s >= '') {} }",
  "function f(s: string) { if ('' > s) {} }",
  "function f(s: 'a' | 'b') { if (s < 'a') {} }",
])("a String comparison the limits settle is refused: %s", expectStaticTypeError);

test.each([
  "function f(s: string) { if (s < 'a') {} } 'ok';",
  "function f(s: 'a' | 'b') { if (s <= 'a') {} } 'ok';",
])("a String comparison left open is accepted: %s", (source) => expect(ok(source)).toBe(true));
