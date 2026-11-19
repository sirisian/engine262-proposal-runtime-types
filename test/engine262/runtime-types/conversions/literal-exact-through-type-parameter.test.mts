import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * #sec-explicit-conversion: "A literal operand, whether a numeric literal or an
 * expression built only of literals, is converted from its exact value, the
 * mathematical value LiteralValueInType reads before any rounding."
 *
 * The checker reads that value where the target is written, at that type, and
 * marks the operand for the run time. A TYPE PARAMETER's type is known only
 * when the conversion runs, so nothing was marked: `9007199254740993 := T` was
 * the double ...992 at `T` = `uint64`, `0.1 := T` the double nearest a tenth at
 * `decimal128` and `rational64`, and `2 ** 64 - 1 := T` zero. The value is now
 * recorded without a type and read at the type the parameter resolves to, so
 * each spelling through a parameter gives what the written type gives.
 */

/** `expression := T` in a generic function, and the same with the type written. */
const throughParameter = (expression: string, type: string): [string, string] => [
  evaluated(`function f<T: type>() { return ${expression} := T; } String(f.<${type}>());`),
  evaluated(`String(${expression} := ${type});`),
];

test('a wide integer literal keeps its exact value through a type parameter', () => {
  expect(throughParameter('9007199254740993', 'uint64')).toEqual(['9007199254740993', '9007199254740993']);
  expect(throughParameter('-9007199254740993', 'int64')).toEqual(['-9007199254740993', '-9007199254740993']);
  expect(throughParameter('(9007199254740993)', 'int64')).toEqual(['9007199254740993', '9007199254740993']);
  // the largest int128, which the double rounded up to 2**127 and wrapped to the least
  expect(throughParameter('170141183460469231731687303715884105727', 'int128'))
    .toEqual(['170141183460469231731687303715884105727', '170141183460469231731687303715884105727']);
  expect(throughParameter('0xFFFFFFFFFFFFFFFF', 'uint64')).toEqual(['18446744073709551615', '18446744073709551615']);
  expect(throughParameter('9007199254740993', 'bigint')).toEqual(['9007199254740993', '9007199254740993']);
});

test('a constant expression folds exactly through a type parameter', () => {
  expect(throughParameter('2 ** 64 - 1', 'uint64')).toEqual(['18446744073709551615', '18446744073709551615']);
  expect(throughParameter('9007199254740992 + 1', 'uint64')).toEqual(['9007199254740993', '9007199254740993']);
  expect(evaluated('const K = 9007199254740993; function f<T: type>() { return K := T; } String(f.<uint64>());'))
    .toBe('9007199254740993');
  // a fraction converts by its integer part, as the Number did
  expect(throughParameter('7.5', 'uint8')).toEqual(['7', '7']);
});

test('decimal, rational and narrow float literals read their digits through a type parameter', () => {
  expect(throughParameter('0.1', 'decimal128')).toEqual(['0.1', '0.1']);
  // the cohort member is the literal's, as the digits are
  expect(throughParameter('1.0', 'decimal128')).toEqual(['1.0', '1.0']);
  expect(throughParameter('0.1 + 0.2', 'decimal128')).toEqual(['0.3', '0.3']);
  expect(throughParameter('0.1', 'rational64')).toEqual(['1/10', '1/10']);
  expect(throughParameter('-0.1', 'rational64')).toEqual(['-1/10', '-1/10']);
  expect(throughParameter('0.1 + 0.2', 'rational64')).toEqual(['3/10', '3/10']);
  // one rounding from the digits, not two through the double
  expect(throughParameter('16777217.0000000001', 'float32')).toEqual(['16777218', '16777218']);
  expect(throughParameter('0x20000000000001', 'float128')).toEqual(['9007199254740993', '9007199254740993']);
  expect(throughParameter('-0.1', 'float128')).toEqual(['-0.1', '-0.1']);
});

test('the call on a type parameter reads the literal as := does', () => {
  expect(evaluated('function f<T: type>() { return T(9007199254740993); } String(f.<uint64>());')).toBe('9007199254740993');
  expect(evaluated('function f<T: type>() { return T(0.1); } String(f.<rational64>());')).toBe('1/10');
  expect(evaluated('class B<T: type> { make() { return 9007199254740993 := T; } } String(new (B.<uint64>)().make());'))
    .toBe('9007199254740993');
});

test('a type that takes the Number still takes it', () => {
  expect(throughParameter('9007199254740993', 'number')).toEqual(['9007199254740992', '9007199254740992']);
  expect(evaluated('function f<T: type>() { return 5 := T; } typeof f.<string>();')).toBe('string');
});

/**
 * The written type had a gap of its own: a BARE literal that its integer type
 * cannot hold converted from its double, where a constant expression folded
 * and wrapped exactly. `9007199254740993` is 2**53 + 1, which wraps to 1 in a
 * `uint8`; its double is 2**53, which wraps to 0.
 */
test('a bare literal that an integer type cannot hold wraps from its exact value', () => {
  expect(evaluated('String(9007199254740993 := uint8);')).toBe('1');
  expect(evaluated('String(uint8(9007199254740993));')).toBe('1');
  expect(evaluated('String(18446744073709551617 := uint64);')).toBe('1');
  // a literal the double holds is unchanged
  expect(evaluated('String(300 := uint8);')).toBe('44');
});
