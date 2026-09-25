import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * A literal operand of an explicit conversion is converted from its exact value.
 *
 * #sec-literalvalueintype: a literal's value is "the mathematical value denoted
 * by the literal ... before any rounding" - `0.1` "denotes one tenth, not the
 * Number nearest to one tenth". And an explicit conversion's two spellings, the
 * call and `:=`, "are the same operation".
 *
 * They were not. The call typed a bare literal at a rational or decimal target
 * without its context, so `rational(0.1)` was the dyadic value while
 * `rational(-0.1)` - a folded constant - was -1/10; the operator offered its
 * target only to a bare literal, so `-0.1 := rational` was dyadic while
 * `0.1 := rational` was 1/10. A sign changed the rule, in opposite directions.
 *
 * A float VALUE still converts from its bits: only a literal is read.
 */

const DYADIC = '3602879701896397/36028797018963968';
const v = (expr: string) => evaluated(`String(${expr});`);

test('a literal is read for its digits, in every spelling', () => {
  for (const src of ['rational(0.1)', '0.1 := rational']) expect(v(src)).toBe('1/10');
  expect(evaluated('let r: rational = 0.1; String(r);')).toBe('1/10');
  for (const src of ['rational(-0.1)', '-0.1 := rational']) expect(v(src)).toBe('-1/10');
  for (const src of ['rational(1 / 3)', '(1 / 3) := rational']) expect(v(src)).toBe('1/3');
  expect(v('rational(0.1 + 0.2)')).toBe('3/10');
  for (const src of ['decimal128(0.1)', '0.1 := decimal128']) expect(v(src)).toBe('0.1');
  expect(v('decimal128(19.99)')).toBe('19.99');
});

test('a float value converts from its binary value', () => {
  expect(evaluated('let x = 0.1; String(rational(x));')).toBe(DYADIC);
  expect(evaluated('const f: float64 = 0.1; String(rational(f));')).toBe(DYADIC);
  expect(evaluated('let x = 0.1; String(decimal128(x));')).toBe('0.1000000000000000055511151231257827');
  // The deliberate route to a literal's binary value: make it a float first.
  expect(v('rational(float64(0.1))')).toBe(DYADIC);
});

test('the conversion still wraps; only the declaration checks the range', () => {
  for (const src of ['uint8(300)', '300 := uint8', '(200 + 100) := uint8']) expect(v(src)).toBe('44');
  expect(v('-300 := uint8')).toBe('212');
  expectStaticTypeError('let x: uint8 = 300;');
  expect(v('uint64(9007199254740993)')).toBe('9007199254740993');
});

test('the two-argument constructor keeps an integer numerator', () => {
  expect(v('rational(3, 4)')).toBe('3/4');
  expect(v('rational(5)')).toBe('5');
});
