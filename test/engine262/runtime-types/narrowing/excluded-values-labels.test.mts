import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowing-flow: a failed literal comparison or literal-pattern selection
// records the excluded value, and a later literal test whose whole success set is
// excluded, a `case` label, a literal pattern or an equality, is impossible.

test.each([
  "function f(x: uint8) { if (x === 1) return; switch (x) { case 1: return 0; } return 1; }",
  "function f(x: uint8) { if (x === 1) return; return match (x) { when 1: 0; default: 1; }; }",
  "function f(x: uint8) { return match (x) { when 1: 0; default: x === 1 ? 2 : 3; }; }",
  "function f(x: uint8) { if (x is 1) return; if (x === 1) {} }",
])("a literal test of an excluded value is refused: %s", expectStaticTypeError);

test.each([
  "function f(x: uint8) { if (x === 1) return; switch (x) { case 2: return 0; } return 1; } 'ok';",
  "function f(x: uint8) { return match (x) { when 1: 0; default: 1; }; } 'ok';",
])("a literal test of a value not excluded is accepted: %s", (source) => expect(ok(source)).toBe(true));
