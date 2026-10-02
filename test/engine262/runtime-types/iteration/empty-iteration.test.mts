import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowfrom: entering a `for`-of body is a test, which can never succeed
// where the sequence has no position (#sec-static-iteration-contribution) or the
// counter admits no value (#sec-range-literals).

test.each([
  "function f() { for (const x of []) { return 1; } return 0; }",
  "function f() { for (const i of 0..<0) { return 1; } return 0; }",
])("a loop that can never be entered is refused: %s", expectStaticTypeError);

test.each([
  "function f(t: []) { for (const x of t) { return 1; } return 0; } 'ok';",
  "function f(n: uint8) { for (const i of 0..<n) { return 1; } return 0; } 'ok';",
])("a loop that may be entered is accepted: %s", (source) => expect(ok(source)).toBe(true));
