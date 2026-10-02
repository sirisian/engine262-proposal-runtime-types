import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowing-flow: the finite, infinite and NaN categories a predicate
// establishes are read by every test whose whole success set they decide.

test.each([
  "function f(x: float64) { if (Number.isNaN(x)) return; if (x !== x) {} }",
  "function f(x: float64) { if (Number.isFinite(x)) { if (x === Infinity) {} } }",
  "function f(x: float64) { if (Number.isNaN(x)) { if (x === 0) {} } }",
  "function f(x: float64) { if (Number.isNaN(x)) { if (x > 0) {} } }",
])("a test the categories settle is refused: %s", expectStaticTypeError);

test.each([
  "function f(x: float64) { if (x !== x) {} if (x === Infinity) {} } 'ok';",
])("a test with no category proof is accepted: %s", (source) => expect(ok(source)).toBe(true));
