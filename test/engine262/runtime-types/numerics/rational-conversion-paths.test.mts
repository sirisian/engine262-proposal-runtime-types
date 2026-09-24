import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-conversions, #table-numeric-conversions, #sec-rational-types,
 * #sec-requiretype.
 *
 * `rational(v)` and `v := rational` are "the same operation", and the boundary
 * converts by the same row. There were three implementations, and they
 * disagreed: `rational(NaN)` was a RangeError while `NaN := rational` and the
 * boundary were a TypeError, and a `float32` or a `decimal` converted by the
 * call form but not by `:=`. All three now run one conversion.
 *
 * NaN and the infinities are a RangeError: "A rational type has no ... infinity,
 * and no NaN", the row names the error, and #sec-requiretype makes a numeric
 * value that fails a numeric conversion "a question of range".
 *
 * Every value here is produced at RUN TIME. A constant written in place is
 * folded by the checker before any conversion runs, and folded differently for
 * each spelling - a separate question this file does not test.
 */

// Each value is built at run time, so no path sees a folded constant.
const VALUES: Record<string, string> = {
  nan: 'Number("NaN")',
  inf: 'Number("Infinity")',
  ninf: 'Number("-Infinity")',
  f32nan: '(Number("NaN") := float32)',
  half: 'Number("0.5")',
  tenth: 'Number("0.1")',
  f32half: '(Number("0.5") := float32)',
  f64: '(Number("-2.25") := float64)',
  dec: '(decimal64("1.5"))',
  u8: '(Number("5") := uint8)',
  i64: '(Number("-7") := int64)',
  wide: '(BigInt("9007199254740993") := int64)',
  big: 'BigInt("5")',
  str: 'String("1/2")',
};

const call = (v: string) => `String(rational(${v}));`;
const op = (v: string) => `String((${v}) := rational);`;
const boundary = (v: string) => `let v: any = ${v}; let r: rational = v; String(r);`;

test('NaN and the infinities are a RangeError by every path', () => {
  for (const k of ['nan', 'inf', 'ninf', 'f32nan']) {
    for (const src of [call(VALUES[k]), op(VALUES[k]), boundary(VALUES[k])]) {
      expectThrownKind(src, 'RangeError');
    }
  }
});

test('a finite value converts to its exact value, by every path', () => {
  const want: [string, string][] = [
    ['half', '1/2'],
    ['tenth', '3602879701896397/36028797018963968'],
    ['f32half', '1/2'],
    ['f64', '-9/4'],
    ['dec', '3/2'],
    ['u8', '5'],
    ['i64', '-7'],
  ];
  for (const [k, result] of want) {
    for (const src of [call(VALUES[k]), op(VALUES[k]), boundary(VALUES[k])]) {
      expect(evaluated(src)).toBe(result);
    }
  }
});

test('a wide integer converts exactly, not through a Number', () => {
  // Read through a Number, an int64 above 2**53 would round to ...992.
  for (const src of [call(VALUES.wide), op(VALUES.wide), boundary(VALUES.wide)]) {
    expect(evaluated(src)).toBe('9007199254740993');
  }
});

test('a source the table has no row for is a TypeError, by every path', () => {
  for (const k of ['big', 'str']) {
    for (const src of [call(VALUES[k]), op(VALUES[k]), boundary(VALUES[k])]) {
      expectThrownKind(src, 'TypeError');
    }
  }
});

test('neighbouring conversions are unchanged', () => {
  expectThrownKind('Number("NaN") := bigint;', 'RangeError');
  expect(evaluated('String(Number("NaN") := int64);')).toBe('0');
  // The 64-bit bound of rational.<64> is not enforced yet, here or anywhere.
  expect(evaluated('String((Number("1e30") := rational).numerator > 0);')).toBe('true');
});
