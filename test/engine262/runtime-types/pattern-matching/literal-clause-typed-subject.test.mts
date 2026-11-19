import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * #sec-match-patterns: "a numeric literal takes the contextual type of the
 * pattern's position". A clause's position is the subject narrowed by the
 * clause's own pattern, so `when 1` over a `uint8` sees the literal `1` whose
 * base is `uint8`. The checker recorded a type for the literal only where the
 * position was a numeric type itself, so in a `match` clause the literal stayed
 * a Number when it ran and matched no `uint8` 1, where `k is 1` and
 * `switch (k) { case 1: }` did; and `when 1 or 2` was refused.
 */

const M = (type: string, clauses: string) => `function f(k: ${type}) { return match (k) { ${clauses} when _: "other"; }; } `;

test('a literal clause matches a typed subject of its value', () => {
  expect(evaluated(`${M('uint8', 'when 1: "one";')}String(f(uint8(1)));`)).toBe('one');
  expect(evaluated(`${M('int32', 'when -1: "neg";')}String(f(int32(-1)));`)).toBe('neg');
  expect(evaluated(`${M('float64', 'when 1.5: "x";')}String(f(float64(1.5)));`)).toBe('x');
  expect(evaluated(`${M('uint8', 'when 0: "zero";')}String(f(uint8(0)));`)).toBe('zero');
  expect(evaluated('const K: uint8 = 1; String(match (K) { when 1: "one"; when _: "other"; });')).toBe('one');
  // And a value it does not hold falls through, as before.
  expect(evaluated(`${M('uint8', 'when 1: "one";')}String(f(uint8(2)));`)).toBe('other');
});

test('an or-pattern of literals is admitted at a typed subject', () => {
  expect(evaluated(`${M('uint8', 'when 1 or 2: "small";')}String(f(uint8(2)));`)).toBe('small');
  expect(evaluated(`${M('uint8', 'when 1 or 2: "small";')}String(f(uint8(3)));`)).toBe('other');
});

test('a literal the position cannot hold is still refused before running', () => {
  expectStaticTypeError(`${M('uint8', 'when 300: "big";')}`);
  expectStaticTypeError('function f(k: 1 | 2) { return match (k) { when 3: "three"; when _: "other"; }; }');
});
