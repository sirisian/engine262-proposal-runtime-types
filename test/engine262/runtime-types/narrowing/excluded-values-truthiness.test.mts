import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowing-flow: a truthiness test is a literal test over a falsy part that
// is a finite set of literals, so one whose every falsy value is excluded can never
// fail; a float, which can be NaN, is not judged.

test.each([
  "function f(x: uint8) { if (x === 0) return; if (x) {} }",
  "function f(s: string) { if (s === '') return; if (s) {} }",
])("a truthiness test the exclusions settle is refused: %s", expectStaticTypeError);

test.each([
  "function f(x: uint8) { if (x === 1) return; if (x) {} } 'ok';",
  "function f(x: float64) { if (x === 0) return; if (x) {} } 'ok';",
])("a truthiness test the exclusions leave open is accepted: %s", (source) => expect(ok(source)).toBe(true));
