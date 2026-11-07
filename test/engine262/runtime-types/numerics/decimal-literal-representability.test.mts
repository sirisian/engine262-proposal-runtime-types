import { test, expect } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

// #sec-literalvalueintype: representability is exact for a decimal type. A
// literal's coefficient is the digits it writes and its exponent their
// position, so a literal whose coefficient or exponent the type cannot hold is
// unrepresentable, a type error rather than a rounded value; only a binary
// float rounds a literal.

const rule = (source: string) => (observeScript(source).diagnostic as { rule?: string } | undefined)?.rule;

test('a coefficient longer than the type holds is refused', () => {
  expect(rule('let d: decimal32 = 0.123456789;')).toBe('rt-numeric-range');
  expect(rule('let d: decimal64 = 1.2345678901234567;')).toBe('rt-numeric-range');
});

test('an exponent outside the type\'s range is refused', () => {
  expect(rule('let d: decimal128 = 1e-7000;')).toBe('rt-numeric-range');
});

test('a literal the type holds keeps its written digits', () => {
  expect(evaluated('let d: decimal32 = 0.1234567; String(d);')).toBe('0.1234567');
  expect(evaluated('let d: decimal32 = 1.000; String(d);')).toBe('1.000');
  expect(evaluated('let d: decimal32 = 1_000.5; String(d);')).toBe('1000.5');
  expect(evaluated('let f: float32 = 0.123456789; String(f > 0);')).toBe('true');
});

// #sec-explicit-conversion: a conversion's operand converts rather than adopts,
// so it rounds to the target's precision and checks the result's range.
test('an explicit conversion rounds instead', () => {
  expect(evaluated('String(decimal32(0.123456789));')).toBe('0.1234568');
  expect(evaluated('String((0.123456789 := decimal32));')).toBe('0.1234568');
});
