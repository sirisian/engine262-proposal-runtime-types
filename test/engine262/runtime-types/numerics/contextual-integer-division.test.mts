import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * `/` AT AN INTEGER CONTEXT IS INTEGER DIVISION, truncating toward zero.
 *
 * rational.md states the rule and gives this as its example: "With an `int32`
 * context the same `1 / 3` is integer division and gives `0`; in an untyped
 * context it is `Number` division and gives `0.333…`. The literal never converts
 * a typed value - it just adopts the type the context asks for."
 *
 * The constant folder previously folded `/` only where the quotient was exact,
 * so `7 / 2` fell through to Number arithmetic, produced `3.5`, and was refused
 * as out of range - an error naming an intermediate value the program never
 * wrote, and a rule no neighbouring language has.
 *
 * It also split `/` from itself. The contextual type decides the operator for a
 * `rational`, where `1 / 3` is exactly `1/3`, and decided nothing for an
 * integer. One rule now covers both: the context says what the operator means.
 */

test('an integer context truncates toward zero', () => {
  expect(evaluated('let a: int32 = 7 / 2; String(a);')).toBe('3');
  expect(evaluated('let a: int32 = 1 / 3; String(a);')).toBe('0');
  expect(evaluated('let a: uint8 = 7 / 2; String(a);')).toBe('3');
  expect(evaluated('let a: int64 = 7 / 2; String(a);')).toBe('3');
});

test('truncation is toward zero, not toward negative infinity', () => {
  // The C, C++, Rust and Go rule, which memorylayout.md already names as this
  // proposal's default for layout. `Math.floor` would give -4.
  expect(evaluated('let a: int32 = -7 / 2; String(a);')).toBe('-3');
  expect(evaluated('let a: int32 = 7 / -2; String(a);')).toBe('-3');
});

test('an exact quotient is unchanged, and the range check still applies', () => {
  expect(evaluated('let a: int32 = 10 / 2; String(a);')).toBe('5');
  expect(evaluated('let a: int32 = 1 + 7 / 2; String(a);')).toBe('4');
  // Truncating does not excuse a result the type cannot hold.
  expectThrown('let a: uint8 = 300 / 1;', 'is not in the range of');
  expectThrown('let a: int32 = 1 / 0;', 'is not in the range of');
});

test('every other context is untouched', () => {
  // The rational context, where `/` is exact division - the other half of the
  // same rule.
  expect(evaluated('let r: rational = 1 / 3; String(r);')).toBe('1/3');
  expect(evaluated('let f: float64 = 1 / 3; String(f);')).toBe('0.3333333333333333');
  expect(evaluated('let d: decimal128 = 0.1 + 0.2; String(d);')).toBe('0.3');
  // No context at all: ordinary Number division.
  expect(evaluated('let n = 7 / 2; String(n);')).toBe('3.5');
});
