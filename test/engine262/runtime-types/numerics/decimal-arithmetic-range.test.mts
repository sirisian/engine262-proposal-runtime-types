import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * #sec-numeric-types, on how the families differ when a result does not fit:
 * "A float already saturates, to an infinity, and a decimal already raises a
 * *RangeError*, since a decimal's range is a property of the type rather than
 * of the format."
 *
 * It did not. Decimal arithmetic built its result without asking whether the
 * width could hold it, so `decimal32('9e90') * decimal32('9e90')` answered
 * 8.1e181 and `decimal32('9e96') + decimal32('9e96')` answered 1.8e97 - values
 * no `decimal32` holds, typed `decimal32`, silently.
 *
 * Every operator builds its result at one place, so the check sits there rather
 * than in each arm.
 */

test('a decimal result outside the width raises a RangeError', () => {
  expectThrownKind("let a = decimal32('9e90'); let b = decimal32('9e90'); a * b;", 'RangeError');
  expectThrownKind("let a = decimal32('9e96'); let b = decimal32('9e96'); a + b;", 'RangeError');
});

test('a wider decimal has the headroom its own range gives', () => {
  // The range is the TYPE's, so the same digits fit where the width allows.
  expect(evaluated("let a = decimal64('9e90'); let b = decimal64('9e90'); "
    + 'String(String(a * b).length);')).toBe('182');
});

test('arithmetic in range is unchanged, cohort and all', () => {
  expect(evaluated("let a = decimal32('2.5'); let b = decimal32('1.5'); String(a * b);")).toBe('3.75');
  // The quantum survives the addition, which is the reason these types exist.
  expect(evaluated("let a = decimal32('2.5'); let b = decimal32('1.5'); String(a + b);")).toBe('4.0');
  expect(evaluated("let a = decimal64('5'); let b = decimal64('3'); String(a - b);")).toBe('2');
  expect(evaluated("let a = decimal64('2.5'); let b = decimal64('1.5'); String(a / b);")).toBe('1.666666666666667');
  // And a zero divisor keeps its own error.
  expectThrownKind("let a = decimal64('1'); let b = decimal64('0'); a / b;", 'RangeError');
});

test('the two spellings of a string conversion agree', () => {
  // `parse` range-checked these digits and the conversion did not, so
  // `decimal32('1e97')` built a value that `decimal32.parse('1e97')` refused.
  expectThrownKind("decimal32('1e97');", 'RangeError');
  expectThrownKind("decimal32.parse('1e97');", 'RangeError');
  expect(evaluated("let d = decimal32('1e96'); String(String(d).length);")).toBe('97');
});
