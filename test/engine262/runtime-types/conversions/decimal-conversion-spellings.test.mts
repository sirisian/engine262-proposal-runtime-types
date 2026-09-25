import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * Conversion to a decimal: one operation, two spellings.
 *
 * #sec-conversions: calling the type, `decimal128(x)`, and the operator,
 * `x := decimal128`, are the same operation, and #table-numeric-conversions'
 * row to a decimal is "any numeric type". The operator refused every source that
 * was not a literal while the call converted a Number, and neither converted a
 * rational. Both now call ConvertToDecimal.
 */

const sources: [string, string, string][] = [
  ['a Number value', 'let x = 0.5;', '0.5'],
  ['a float64 value', 'let x: float64 = 0.5;', '0.5'],
  ['a bigint', 'let x = 5n;', '5'],
  ['a float128', 'let x = (1 := float128) / (3 := float128);', '0.3333333333333333333333333333333333'],
  ['a terminating rational', 'let x = rational(-7, 8);', '-0.875'],
  ['a non-terminating rational', 'let x = rational(1, 3);', '0.3333333333333333333333333333333333'],
  ['a string, keeping its cohort member', "let x = '1.50';", '1.50'],
];

test('the call and the operator agree for every source', () => {
  for (const [label, decl, want] of sources) {
    expect(evaluated(`${decl} String(decimal128(x));`), `${label}, called`).toBe(want);
    expect(evaluated(`${decl} String(x := decimal128);`), `${label}, as :=`).toBe(want);
  }
});

test('a rational: exact where its expansion terminates, rounded once where it does not', () => {
  expect(evaluated('String(decimal32(rational(1, 8)));')).toBe('0.125');
  expect(evaluated('String(decimal32(rational(2, 3)));')).toBe('0.6666667');
  expect(evaluated('String(rational(2, 3) := decimal32);')).toBe('0.6666667');
});

test('what does not change', () => {
  // A literal is still read from its digits (L1), not converted from a double.
  expect(evaluated('String(0.1 := decimal128);')).toBe('0.1');
  // A double still carries its binary value (decimal.md).
  expect(evaluated('let f = 0.1; String(f := decimal128);')).toBe('0.1000000000000000055511151231257827');
  expect(evaluated("String(decimal64('1.23456789012345678') := decimal32);")).toBe('1.234568');
  expectThrownKind('(3 := complex64) := decimal128;', 'TypeError');
});
