import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-requiretype, #table-numeric-conversions, #sec-selectunionmember.
 *
 * At a dynamic boundary every numeric type follows RequireType's rule: a
 * conversion that would wrap, truncate toward zero, or round a finite value to
 * an infinity is refused with a *RangeError*, and every other conversion is
 * performed - including rounding a finite value into a float. `bigint` followed
 * it in some directions and was refused in others: into `number` but not
 * `float64`, from a Number but not a float, never into a sized integer, and
 * refusing finite rounding every other source performs.
 *
 * The consequence that mattered most: a BigInt reaching a union such as
 * `uint8 | string` skipped the numeric member that represents it exactly and was
 * stored as the STRING "5" - the textification SelectUnionMember exists to
 * prevent.
 *
 * `bigint` is now an ordinary numeric type at the boundary. The operator rule is
 * unchanged: `1n + 1` is still a TypeError, since operators never convert.
 */

const at = (value: string, target: string) => `let v: any = ${value}; let x: ${target} = v; String(x);`;

test('into bigint: a finite integer converts, whatever numeric type holds it', () => {
  expect(evaluated(at('5', 'bigint'))).toBe('5');
  expect(evaluated(at('-5', 'bigint'))).toBe('-5');
  // A BigInt has no negative zero, and -0 is integer-valued.
  expect(evaluated(at('-0', 'bigint'))).toBe('0');
  // Every finite integer-valued double is exactly one BigInt - not only safe
  // ones. The loss beyond 2**53 happens where a literal becomes a Number, before
  // this boundary; `uint64` accepts the same Number here.
  expect(evaluated(at('9007199254740992', 'bigint'))).toBe('9007199254740992');
  expect(evaluated(at('1152921504606846976', 'bigint'))).toBe('1152921504606846976');
  expect(evaluated(at('1e21', 'bigint'))).toBe('1000000000000000000000');
  expect(evaluated(at('(5 := uint8)', 'bigint'))).toBe('5');
  expect(evaluated(at('(5 := int64)', 'bigint'))).toBe('5');
  // A float holding an integer, as a Number does and as a float into `int32` does.
  expect(evaluated(at('(5 := float32)', 'bigint'))).toBe('5');
  expect(evaluated(at('(5 := float64)', 'bigint'))).toBe('5');
  // An integer-valued rational, as a rational into `uint8` does.
  expect(evaluated(at('(5 := rational)', 'bigint'))).toBe('5');
});

test('into bigint: a value with no integer is a RangeError, not a TypeError', () => {
  // The conversion exists; this value does not survive it.
  for (const v of ['5.5', 'NaN', 'Infinity', '(5.5 := float32)', '(NaN := float32)', '(Infinity := float64)']) {
    expectThrownKind(at(v, 'bigint'), 'RangeError');
  }
});

test('out of bigint: into a sized integer in range, RangeError where it would wrap', () => {
  expect(evaluated(at('5n', 'uint8'))).toBe('5');
  expect(evaluated(at('5n', 'int64'))).toBe('5');
  expect(evaluated(at('127n', 'int8'))).toBe('127');
  expect(evaluated(at('-128n', 'int8'))).toBe('-128');
  for (const [v, t] of [['300n', 'uint8'], ['-1n', 'uint8'], ['128n', 'int8'], ['(2n ** 64n)', 'uint64']]) {
    expectThrownKind(at(v, t), 'RangeError');
  }
});

test('out of bigint: into a float or number by rounding, refused only at overflow', () => {
  // `number` and `float64` are one double-precision type and now agree.
  expect(evaluated(at('5n', 'number'))).toBe('5');
  expect(evaluated(at('5n', 'float64'))).toBe('5');
  // Finite rounding is performed, as `int64` 2**60+1 into `float64` is.
  expect(evaluated(at('(2n ** 60n + 1n)', 'float64'))).toBe('1152921504606847000');
  expect(evaluated(at('(2n ** 53n + 1n)', 'number'))).toBe('9007199254740992');
  expect(evaluated(at('65504n', 'float16'))).toBe('65504');
  // Overflow to infinity is refused - unchanged.
  for (const [v, t] of [['(2n ** 1024n)', 'float64'], ['(2n ** 128n)', 'float32'], ['70000n', 'float16']]) {
    expectThrownKind(at(v, t), 'RangeError');
  }
});

test('out of bigint: into a complex, as its real component', () => {
  expect(evaluated(at('5n', 'complex64'))).toBe('5+0i');
  // The explicit conversion is never stricter than the boundary.
  expect(evaluated('String(5n := complex64);')).toBe('5+0i');
});

test('a BigInt in a union lands in its exact numeric member, never as a string', () => {
  const member = (value: string, target: string) => `let v: any = ${value}; let x: ${target} = v; String(Reflect.typeOf(x));`;
  expect(evaluated(member('5n', 'uint8 | string'))).toBe('uint.<8>');
  // Member order does not matter.
  expect(evaluated(member('5n', 'string | uint8'))).toBe('uint.<8>');
  expect(evaluated(member('5n', 'int64 | string'))).toBe('int.<64>');
  expect(evaluated(`let v: any = 5n; let x: number | string = v; typeof x;`)).toBe('number');
  // `bigint` is the widest integer, tried last: 300 does not fit `uint8`.
  expect(evaluated(member('300', 'uint8 | bigint'))).toBe('bigint');
});

test('what the boundary does not reach is unchanged', () => {
  // Decimal is refused for every source at a boundary - a separate question.
  expectThrownKind(at('5n', 'decimal64'), 'TypeError');
  expectThrownKind(at('(5 := decimal64)', 'bigint'), 'TypeError');
  // Into `rational`, a `bigint` converts as every integer type does: the
  // implicit-conversions table checks an `any` value at the boundary and, "if it
  // is a numeric value the target represents exactly, converted" - an `int32` 5
  // already did, and the F10 plan's B1 gives `bigint` its conversion row.
  expect(evaluated(at('5n', 'rational'))).toBe('5');
  // `complex` into an integer is refused for `uint8` too.
  expectThrownKind(at('(5 := complex64)', 'bigint'), 'TypeError');
  // Not numeric at all.
  for (const v of ["'5'", 'true', 'null']) expectThrownKind(at(v, 'bigint'), 'TypeError');
  expect(evaluated(at('5n', 'string'))).toBe('5');
});

test('the operator rule is untouched', () => {
  // Operators never convert between numeric types; this change is boundaries only.
  expectThrownKind('1n + 1;', 'TypeError');
  expectThrownKind('5n * 2;', 'TypeError');
});
