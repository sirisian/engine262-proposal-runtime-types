import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-typed-string-properties: a literal String's length and its in-range indices
// are its own and never change, so a test they settle is refused; an index past the
// end reaches String.prototype and is not judged.

test.each([
  "function f(s: 'abc') { if (s.length === 0) {} }",
  "function f(s: 'abc') { if (s.length) {} }",
  "function f(s: 'abc') { if (s[1] === undefined) {} }",
])("a test a literal String settles is refused: %s", expectStaticTypeError);

test.each([
  "function f(s: string) { if (s.length === 0) {} } 'ok';",
  "function f(s: 'abc') { if (s[5] === undefined) {} } 'ok';",
])("a test a String leaves open is accepted: %s", (source) => expect(ok(source)).toBe(true));
