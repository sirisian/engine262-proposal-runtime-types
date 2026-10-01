import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-pattern-static-semantics reads a regular expression by MatchNarrow against
// `string`, and #sec-match-exhaustiveness refuses a clause that can match nothing
// the preceding clauses have left.

test.each([
  "function f(n: uint8) { return match (n) { when /a/: 1; default: 2; }; }",
  "function f(n: uint8) { return match (n) { when 1: 0; when /a/: 1; default: 2; }; }",
])("a regular-expression clause that can match nothing is refused: %s", expectStaticTypeError);

test.each([
  "function f(x: uint8 | string) { return match (x) { when /a/: 1; default: 2; }; } 'ok';",
])("a regular-expression clause that can match is accepted: %s", (source) => expect(ok(source)).toBe(true));
