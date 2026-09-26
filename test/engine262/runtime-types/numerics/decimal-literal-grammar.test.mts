import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-parsing.
 *
 * "The accepted input is THE GRAMMAR OF A LITERAL OF THAT TYPE, with optional
 * leading and trailing white space and an optional sign. NUMERIC SEPARATORS ARE
 * ACCEPTED ... `parse` throws a *SyntaxError* when the string is not a literal
 * of the type, and a *RangeError* when it is a literal whose value the type
 * cannot represent. Each type also has a `tryParse` function."
 *
 * A decimal literal has no grammar of its own - it is a `NumericLiteral` read in
 * a decimal context - so the literal grammar is ECMAScript's `DecimalLiteral`,
 * which carries an exponent part and numeric separators. The decimal parser read
 * a narrower grammar than that while `float64.parse('1e20')` and
 * `uint32.parse('1_000')` read the whole of it: one clause, one sentence, and one
 * family behaving differently.
 *
 * The same digits are read by the string conversion, so `decimal128.parse('1e200')`
 * moves with `parse`.
 */

test('an exponent part is part of the literal', () => {
  expect(evaluated("String(decimal64.parse('1e20'));")).toBe('100000000000000000000');
  expect(evaluated("String(decimal64.parse('1E5'));")).toBe('100000');
  expect(evaluated("String(decimal64.parse('1e-5'));")).toBe('0.00001');
  // The exponent SHIFTS the point the fraction already fixed, so the two
  // compose: `1.5e3` is 15 at exponent -1, shifted by 3.
  expect(evaluated("String(decimal64.parse('1.5e3'));")).toBe('1500');
  // And the conversion reads the same digits.
  expect(evaluated("String(decimal128.parse('1e5'));")).toBe('100000');
});

test('numeric separators are accepted where the grammar allows them', () => {
  expect(evaluated("String(decimal64.parse('1_000.5'));")).toBe('1000.5');
  expect(evaluated("String(decimal64.parse('1.000_5'));")).toBe('1.0005');
  // And refused where it does not: a separator may not lead, trail, double up,
  // or sit against the point.
  expectThrownKind("decimal64.parse('_1.5');", 'SyntaxError');
  expectThrownKind("decimal64.parse('1.5_');", 'SyntaxError');
  expectThrownKind("decimal64.parse('1__5');", 'SyntaxError');
  expectThrownKind("decimal64.parse('1_.5');", 'SyntaxError');
});

test('the forms that already worked are unchanged', () => {
  expect(evaluated("String(decimal64.parse('19.99'));")).toBe('19.99');
  expect(evaluated("String(decimal64.parse('-1.5'));")).toBe('-1.5');
  expect(evaluated("String(decimal64.parse('  1.5  '));")).toBe('1.5');
  expectThrownKind("decimal64.parse('1.5x');", 'SyntaxError');
});

test('a literal the type cannot represent is a RangeError, not a SyntaxError', () => {
  // "a *RangeError* when it is a literal whose value the type cannot
  // represent". Reachable only now that the grammar admits an exponent - there
  // was no way to write an out-of-range decimal before, and once there was, it
  // built a value no `decimal32` holds.
  expectThrownKind("decimal32.parse('1e300');", 'RangeError');
  expect(evaluated("String(String(decimal64.parse('1e300')).length > 0);")).toBe('true');
});

test('a decimal has a tryParse, as every type does', () => {
  expect(evaluated("String(decimal64.tryParse('1.5'));")).toBe('1.5');
  expect(evaluated("String(decimal64.tryParse('1.5e3'));")).toBe('1500');
  expect(evaluated("String(decimal64.tryParse('zz'));")).toBe('null');
  // A RANGE FAILURE THROWS, here as in every family. It is not a failure to
  // parse: the string was a literal of the type and its value did not fit,
  // which is the other failure `parse` distinguishes and the one `tryParse`
  // does not swallow.
  expectThrownKind("decimal32.tryParse('1e300');", 'RangeError');
  expectThrownKind("uint8.tryParse('300');", 'RangeError');
});

/**
 * #sec-parsing: `parse` "returns A VALUE OF THE TYPE the function belongs to",
 * and throws "a *RangeError* when it is a literal whose value the type cannot
 * represent".
 *
 * A narrow float's parse returned the DOUBLE it read, tagged with the type.
 * `float16.parse('0.1')` was `0.1` where `float16(0.1)` is `0.0999755859375`,
 * and `float16.parse('1e300')` was `1e+300` - a value no `float16` holds,
 * answering `float16` to `Reflect.typeOf`. The range test could not catch it:
 * `fitsNumericType` answers *true* for every float name, so it is a no-op on
 * that family.
 */
test('a parsed float is a value of the float type', () => {
  expect(evaluated("String(float16.parse('0.1'));")).toBe('0.0999755859375');
  expect(evaluated("String(float32.parse('0.1'));")).toBe('0.10000000149011612');
  // The conversion is the same value, which is the point: one set of digits,
  // one float16.
  expect(evaluated('let n = 0.1; String(float16(n));')).toBe('0.0999755859375');
  expect(evaluated('let n = 0.1; String(float32(n));')).toBe('0.10000000149011612');
  // A double IS a float64, so that family is unchanged.
  expect(evaluated("String(float64.parse('0.1'));")).toBe('0.1');
});

test('a literal a float type cannot represent is a RangeError', () => {
  expectThrownKind("float16.parse('1e300');", 'RangeError');
  expectThrownKind("float16.parse('70000');", 'RangeError');
  expectThrownKind("float16.tryParse('1e300');", 'RangeError');
  // The largest finite float16, and an explicit infinity, are both values of
  // the type.
  expect(evaluated("String(float16.parse('65504'));")).toBe('65504');
  expect(evaluated("String(float16.parse('Infinity'));")).toBe('Infinity');
});

test('a CONVERSION still overflows to an infinity', () => {
  // Where a parse refuses, the conversion's own table row applies: "A finite
  // source outside the target's range becomes an infinity of the same sign."
  // The two operations part company here and should.
  expect(evaluated('let n = 1e300; String(float16(n));')).toBe('Infinity');
  expect(evaluated('let n = 1e300; String(float32(n));')).toBe('Infinity');
});
