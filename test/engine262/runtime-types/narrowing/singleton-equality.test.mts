import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #table-narrowing-forms, the `v === w` row: two operands each of one literal type
// over one base are equal exactly where their values are.

test.each([
  "function f(a: 1, b: 1) { if (a === b) {} }",
  "function f(a: 'x', b: 'x') { if (a !== b) {} }",
])("a comparison of two singletons is refused: %s", expectStaticTypeError);

test.each([
  "function f(a: 1 | 2, b: 1) { if (a === b) {} } 'ok';",
])("a comparison with a wider operand is accepted: %s", (source) => expect(ok(source)).toBe(true));
