import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-which-operations-each-family-defines lists unaryMinus for the
 * rational family; "Unary `-` applies T::unaryMinus for the numeric type T of
 * its operand." rational.md: "unary `-` negates the numerator."
 *
 * The dispatch had negation for typed numbers, vectors, complex, decimal and
 * ranges, but none for a rational, which fell through to ToNumeric - where a
 * rational has no Number value - so even `-rational(3, 4)` was a TypeError,
 * though the checker, reading the same table, accepted it.
 */

test('unary minus negates a rational', () => {
  expect(evaluated('String(-rational(3, 4));')).toBe('-3/4');
  expect(evaluated('String(-rational(-3, 4));')).toBe('3/4');
  expect(evaluated('String(-(-rational(5, 7)));')).toBe('5/7');
  expect(evaluated('let r: rational = rational(3, 4); String(-r);')).toBe('-3/4');
  expect(evaluated('String((-rational(2, 9)) + rational(2, 9));')).toBe('0');
  // The result keeps its type.
  expect(evaluated('String(Reflect.typeOf(-rational(3, 4)));')).toBe('rational');
});

test('a rational has no negative zero', () => {
  // #sec-rational-types: "A rational type has no negative zero."
  expect(evaluated('String(-rational(0, 1));')).toBe('0');
  expect(evaluated('String(Object.is(-rational(0, 1), rational(0, 1)));')).toBe('true');
});

test('negation respects the 64-bit bound', () => {
  expect(evaluated("String(-rational(BigInt('9223372036854775807') := int64, 1));"))
    .toBe('-9223372036854775807');
  // -2**63 is an int64, but its negation, 2**63, is not.
  expectThrownKind('-rational(-(2**63), 1);', 'RangeError');
});

test('operators the table does not list for rationals stay refused', () => {
  // The same table lists neither bitwiseNOT nor remainder for the family.
  // Refused before the program runs.
  expectStaticTypeError('~rational(3, 4);');
  expectStaticTypeError('rational(3, 4) % rational(1, 2);');
});

test('the other families are unchanged', () => {
  // A decimal keeps its cohort member through negation.
  expect(evaluated("String(-decimal64('1.50'));")).toBe('-1.50');
  expect(evaluated('String(-(5 := int64));')).toBe('-5');
  // Unsigned negation wraps, per #sec-unary-operators.
  expect(evaluated('String(-(5 := uint8));')).toBe('251');
  expect(evaluated('String(-5n);')).toBe('-5');
});
