import { expect, test } from 'vitest';
import { evaluated, expectThrownKind, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-rational-types; rational.md.
 *
 * `rational.<N>` holds "the exact rational numbers representable as a quotient
 * of two values of `int.<N>`", and "an operation whose exact result is not
 * representable, including one whose normalized numerator or denominator falls
 * outside `int.<N>`, throws a RangeError rather than rounding." The bare
 * `rational` is `rational.<64>`.
 *
 * Every rational value is built by one constructor, which enforces the bound, so
 * conversion, arithmetic, literals, `Math` and `++` all reach it. The check is on
 * the NORMALIZED fraction. The canonical denominator is positive, so it spans 1
 * to 2**63 - 1; the numerator spans all of `int.<64>`.
 */

const i64 = (digits: string) => `(BigInt('${digits}') := int64)`;
const MAX = '9223372036854775807';

test('conversion refuses a value that does not fit', () => {
  // A LITERAL out of range is refused before the program runs - #sec-literal-types:
  // "a literal whose value that type cannot represent is a type error rather
  // than a silent truncation" (the F10 plan's L1).
  for (const src of ['1e308 := rational;', '5e-324 := rational;', 'rational(1e308);', 'let r: rational = 1e30;']) {
    expectStaticTypeError(src);
  }
  // A VALUE out of range is refused when it is converted.
  expectThrownKind('let v: any = 1e308; let r: rational = v;', 'RangeError');
});

test('arithmetic refuses a result that does not fit', () => {
  expectThrownKind('rational(2**62, 1) * rational(2**62, 1);', 'RangeError');
  // The harmonic sum's denominator first leaves int.<64> at the 47th term.
  const harmonic = (n: number) => `let h = rational(0, 1); for (let k = 1; k <= ${n}; k++) h = h + rational(1, k); 'ok';`;
  expect(evaluated(harmonic(46))).toBe('ok');
  expectThrownKind(harmonic(47), 'RangeError');
  // `++` past the largest numerator.
  expectThrownKind(`let r = rational(${i64(MAX)}, 1); r++;`, 'RangeError');
});

test('the check is on the reduced fraction, not an intermediate', () => {
  // (2**62 * 3) exceeds int.<64>, but the product reduces to 2.
  expect(evaluated('String(rational(2**62, 3) * rational(3, 2**61));')).toBe('2');
});

test('both ends of int.<64> are exact', () => {
  expect(evaluated(`String(rational(${i64(MAX)}, 1));`)).toBe(MAX);
  expect(evaluated('String(rational(-(2**63), 1));')).toBe('-9223372036854775808');
  expect(evaluated(`String(rational(1, ${i64(MAX)}).denominator);`)).toBe(MAX);
  // -2**63 is an int64, but its magnitude, 2**63, is not.
  expectThrownKind('rational(0, 1) - rational(-(2**63), 1);', 'RangeError');
  expectThrownKind('Math.abs(rational(-(2**63), 1));', 'RangeError');
  expectThrownKind('rational(-(2**63), 1).reciprocal();', 'RangeError');
  // -1/2**63 would need a denominator of 2**63.
  expectThrownKind('rational(1, -(2**63));', 'RangeError');
});

test('the accessors return the exact int.<64> fields', () => {
  // These returned a Number, so a field above 2**53 read back rounded.
  expect(evaluated(`String(rational(${i64('9007199254740993')}, 1).numerator);`)).toBe('9007199254740993');
  expect(evaluated('String(Reflect.typeOf(rational(3, 4).numerator));')).toBe('int.<64>');
  expect(evaluated('String(Reflect.typeOf(rational(3, 4).denominator));')).toBe('int.<64>');
  expect(evaluated('String(Reflect.typeOf(Math.floor(rational(7, 2))));')).toBe('int.<64>');
});

test('ordinary values are unchanged', () => {
  expect(evaluated('String(rational(1, 3) + rational(1, 7));')).toBe('10/21');
  expect(evaluated('String(rational(5.5));')).toBe('11/2');
  expect(evaluated('String(Math.sign(rational(-3, 4)));')).toBe('-1');
  expectThrownKind('rational(1.5, 2);', 'TypeError');
});
