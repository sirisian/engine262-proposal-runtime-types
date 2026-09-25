import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * A literal operand takes the type of the other operand.
 *
 * The contextual-type table: "An operand of a binary operator whose other
 * operand has a known value type - The type of the other operand." A rational
 * adopted no literal at all, so `rational(1, 2) + 0.5` and `rational(1, 2) * 2`
 * were TypeErrors; and no comparison adopted one, so `decimal64('1.5') == 1.5`
 * and `rational(1, 2) < 0.75` threw, while the same values compared correctly
 * against a value of their own type.
 *
 * Comparisons adopt only where the other operand is a decimal, a rational or a
 * complex. The general adoption is deferred behind a builtin the checker types
 * as a typed integer that the run time returns as a Number - no builtin is typed
 * as one of these families, so the blocker cannot reach them.
 */

const v = (expr: string) => evaluated(`String(${expr});`);

test('a rational adopts a literal in arithmetic', () => {
  expect(v('rational(1, 2) + 0.5')).toBe('1');
  expect(v('0.5 + rational(1, 2)')).toBe('1');
  expect(v('rational(1, 2) * 2')).toBe('1');
  expect(v('rational(1, 2) - 1')).toBe('-1/2');
  expect(v('rational(1, 2) / 3')).toBe('1/6');
  // An exponent stays an integer: `**` takes an integer exponent.
  expect(v('rational(1, 2) ** 2')).toBe('1/4');
});

test('a decimal or a rational adopts a literal in == and the comparisons', () => {
  expect(v("decimal64('1.5') == 1.5")).toBe('true');
  expect(v("decimal64('1.5') < 2")).toBe('true');
  expect(v("decimal64('1.5') >= 1.5")).toBe('true');
  expect(v('rational(1, 2) == 0.5')).toBe('true');
  expect(v('0.5 == rational(1, 2)')).toBe('true');
  expect(v('rational(1, 2) < 0.75')).toBe('true');
  expect(v('rational(1, 2) > -1')).toBe('true');
});

test('what adoption must not touch', () => {
  // A Number VALUE is not a literal and does not convert on its own.
  expectThrownKind('let n = 0.5; rational(1, 2) == n;', 'TypeError');
  // `in` reads a literal as a key.
  expect(v('0 in [1]')).toBe('true');
  // The deferred general case: a builtin typed as an integer is left alone.
  expect(v('Object.keys({ a: 1 }).length === 1')).toBe('true');
  expect(v('(5 := uint8) == 5')).toBe('true');
});
