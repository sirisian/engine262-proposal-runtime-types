import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

/**
 * Spec: #table-numeric-conversions, the row `any numeric type` ? `decimal`.
 *
 * "The source's exact value if it is representable, otherwise rounded to the
 * target's precision. A *RangeError* if the source's exponent is outside the
 * target's range, **since a decimal's range is a property of the type rather
 * than of the format**."
 *
 * The precision half was implemented and the range half was not, so
 * `decimal32(1e300)` produced a three-hundred-digit value - a significand of one
 * at an exponent no `decimal32` can hold - and said nothing. The bounds are
 * IEEE 754-2008's, over the ADJUSTED exponent: the exponent of the value written
 * with one digit before the point.
 *
 * Checked on the RESULT rather than the source, because the conversion rounds
 * first and rounding can carry - a significand of nines rounds to a one with an
 * extra digit, which is one higher adjusted exponent.
 */

test('a source outside the target decimal\'s exponent range is refused', () => {
  expectThrownKind('decimal32(1e300);', 'RangeError');
  expectThrownKind('let x = 1e300; decimal32(x);', 'RangeError');
  // decimal32's adjusted exponent tops out at 96.
  expectThrownKind('decimal32(1e97);', 'RangeError');
});

test('the bound itself is admitted', () => {
  expect(evaluated('String(String(decimal32(1e96)).length > 0);')).toBe('true');
  // The same value is comfortably inside the wider types, whose ranges are
  // their own: a decimal's range is the TYPE's, not the double's.
  expect(evaluated('String(String(decimal64(1e300)).length > 0);')).toBe('true');
  expect(evaluated('String(String(decimal128(1e300)).length > 0);')).toBe('true');
});

test('narrowing a decimal to a width that cannot hold it is refused', () => {
  // A decimal to a decimal of another WIDTH re-rounds to that width's
  // precision, and the range applies there for the same reason: the exponent
  // belongs to the target type.
  expectThrownKind('let a = decimal128(1e200); decimal32(a);', 'RangeError');
  // One that fits still narrows.
  expect(evaluated('let a = decimal128(1.5); String(decimal32(a));')).toBe('1.5');
});

test('conversions in range are unchanged', () => {
  // A float64 VALUE carries what it holds, which is the rule decimal.md states
  // and which this does not touch: exact where the double holds the value
  // exactly, the width's full precision where it does not.
  expect(evaluated('let f = 0.5; String(decimal64(f));')).toBe('0.5');
  expect(evaluated('let f = 0.1; String(decimal64(f));')).toBe('0.1000000000000000');
  expect(evaluated('let f = 0.1; String(decimal128(f));')).toBe('0.1000000000000000055511151231257827');
  expect(evaluated('let f = 1.5; String(decimal32(f));')).toBe('1.5');
  expect(evaluated('let f = 0; String(decimal32(f));')).toBe('0');
  // A written decimal is exact and is not a conversion at all.
  expect(evaluated("String(decimal64('0.1'));")).toBe('0.1');
});

/**
 * decimal.md gives three exact spellings and one that carries the bits:
 * `let tenth: decimal128 = 0.1` and `0.1 := decimal128` are exact, the second
 * "forcing decimal on an otherwise-Number literal", while `decimal128(f)`
 * "CARRIES WHATEVER `f` ALREADY HOLDS".
 *
 * The CALL is a conversion whatever its argument looks like: the argument is
 * evaluated first, so by the time the conversion sees it the literal IS the
 * double. A round of this work read "the distinction bites only when a
 * `float64` *value* is involved" as excluding a literal argument and made
 * `decimal128(0.1)` exact - which `type-universe/decimal.test.mts` pins against
 * with the comment "THE ASSERTION THAT SAYS WHY": making it equal
 * `decimal128("0.1")` "would launder a binary approximation into an
 * exact-looking decimal and hide the whole reason these types exist".
 */
test('the exact spellings are the annotation and the cast', () => {
  expect(evaluated('let t: decimal128 = 0.1; String(t);')).toBe('0.1');
  expect(evaluated('String((0.1 := decimal128));')).toBe('0.1');
  expect(evaluated('let p: decimal128 = 19.99; String(p);')).toBe('19.99');
});

test('the call carries the bits, literal argument or not', () => {
  expect(evaluated('String(decimal128(0.1));')).toBe('0.1000000000000000055511151231257827');
  expect(evaluated('String(decimal128(19.99));')).toBe('19.98999999999999843680598132777959');
  // Which is the assertion that says why.
  expect(evaluated("String(decimal128(0.1) == decimal128('0.1'));")).toBe('false');
  // A value the double holds exactly converts exactly, and arrives reduced.
  expect(evaluated('String(decimal128(0.5));')).toBe('0.5');
});

test('a float64 value carries what it holds, typed or not', () => {
  expect(evaluated('let f: float64 = 0.1; String(decimal128(f));'))
    .toBe('0.1000000000000000055511151231257827');
  expect(evaluated('let f = 0.1; String(decimal128(f));'))
    .toBe('0.1000000000000000055511151231257827');
  expect(evaluated('let f: float32 = 0.5; String(decimal64(f));')).toBe('0.5');
});

test('any numeric type is a source, and exact digits are kept', () => {
  // "any numeric type" in #table-numeric-conversions. A wide integer carries a
  // BigInt, whose digits would be lost by rounding through a double first.
  expect(evaluated('let i: uint8 = 3; String(decimal64(i));')).toBe('3');
  expect(evaluated('String(decimal64(3n));')).toBe('3');
  expect(evaluated('let i: uint64 = 9007199254740993; String(decimal128(i));')).toBe('9007199254740993');
  // And still rounded to the target's precision, an exact integer being no
  // exception: decimal32 keeps seven digits.
  expect(evaluated('String(decimal32(123456789012345678901234567890n));')).toBe('123456800000000000000000000000');
});

/**
 * decimal.md, "Conversions - Explicit in every direction, and each names its
 * loss", gives four outgoing rules: "To a binary float: `float64(d)` rounds to
 * the nearest `float64`"; "To an integer: `int64(d)` truncates toward zero";
 * "Between widths: `decimal32` to `decimal128` is exact; the reverse rounds";
 * and the rational pair.
 *
 * `#table-numeric-conversions` marks this direction "Open", and the note beside
 * it explains the difficulty as "which cohort member results" - which is
 * one-sided. A binary type has no cohorts, so nothing has to be chosen going
 * out, and the design settles all four. The integer one was the rule the engine
 * did not have: `int64(d)` and `uint8(d)` were refused as not assignable.
 */
test('a decimal converts to an integer by truncating toward zero', () => {
  expect(evaluated("let d = decimal64('7.9'); String(int64(d));")).toBe('7');
  expect(evaluated("let d = decimal64('-7.9'); String(int64(d));")).toBe('-7');
  expect(evaluated("let d = decimal64('7.9'); String(uint8(d));")).toBe('7');
  expect(evaluated("let d = decimal64('42'); String(int64(d));")).toBe('42');
  // Truncated on the DIGITS, not through a double, so a decimal carrying more
  // significant digits than a double holds keeps them.
  expect(evaluated("let d = decimal128('9007199254740993'); String(int64(d));")).toBe('9007199254740993');
});

test('the outgoing directions the engine already had are unchanged', () => {
  expect(evaluated("let d = decimal64('7.9'); String(float64(d));")).toBe('7.9');
  expect(evaluated("let d = decimal64('7.9'); String(number(d));")).toBe('7.9');
  expect(evaluated("let a = decimal32('1.5'); String(decimal128(a));")).toBe('1.5');
  expect(evaluated("let a = decimal128('1.5'); String(decimal32(a));")).toBe('1.5');
});

test('a boundary is not a conversion', () => {
  // The proposal's own discipline - "a conversion between numeric types is
  // written explicitly rather than performed silently" - so an annotation
  // refuses where the call converts. This holds for every numeric pair, not
  // just for decimals: `let b: uint8 = someUint16` is refused too.
  expectThrownKind("let d = decimal64('7.9'); let i: int64 = d;", 'TypeError');
});

/**
 * #table-numeric-conversions, integer to integer of width _M_: "The
 * mathematical value of the source modulo 2**_M_ ... Signed targets wrap in
 * two's complement." Every numeric source, one spelling, one answer - and a
 * BigInt is a numeric source like any other at an EXPLICIT conversion.
 *
 * The rule it refused under, #sec-requiretype's "a conversion that would wrap
 * ... instead yields ~unrepresentable~", is the BOUNDARY's, and the boundary
 * still applies it. The decimal-to-integer conversion delegates to this same
 * code rather than carrying its own integer rule, so both follow together.
 */
test('every numeric source wraps the same way at an explicit conversion', () => {
  expect(evaluated('let n = 300; String(uint8(n));')).toBe('44');
  expect(evaluated('String(uint8(300n));')).toBe('44');
  expect(evaluated('let a: uint16 = 300; String(uint8(a));')).toBe('44');
  expect(evaluated('let f: float64 = 300; String(uint8(f));')).toBe('44');
  expect(evaluated("let d = decimal64('300'); String(uint8(d));")).toBe('44');
  expect(evaluated('String(int8(200n));')).toBe('-56');
  expect(evaluated('let n = 200; String(int8(n));')).toBe('-56');
  // A width wider than 53 bits still carries its value exactly.
  expect(evaluated('String(uint64(9007199254740993n));')).toBe('9007199254740993');
  expect(evaluated("let d = decimal64('7.9'); String(int64(d));")).toBe('7');
});

test('a boundary still refuses what a conversion wraps', () => {
  expectStaticTypeError('let x: uint8 = 300n;');
  expectStaticTypeError('let x: uint8 = 300;');
});

/**
 * #table-numeric-conversions, `binary float or the Number type` to `rational`:
 * "The source's exact value, which is a dyadic rational, in lowest terms."
 * decimal.md adds the decimal source: "a terminating decimal is exactly a
 * rational with a power-of-ten denominator, so `rational(d)` is exact - `0.1`
 * becomes `1/10`".
 *
 * One numeric argument was answered by the TWO-argument constructor's rule, "a
 * rational numerator must be an integer", so `rational(5)` worked and
 * `rational(0.5)` did not - one spelling, two verdicts, decided by whether the
 * source happened to be integral.
 */
test('one numeric argument is the conversion, exactly', () => {
  expect(evaluated('String(rational(0.5));')).toBe('1/2');
  expect(evaluated('String(rational(0.25));')).toBe('1/4');
  expect(evaluated('String(rational(-0.5));')).toBe('-1/2');
  expect(evaluated('let f: float32 = 0.5; String(rational(f));')).toBe('1/2');
  // The double 0.1 IS a dyadic rational, and this is it - not one tenth, which
  // is the point of converting exactly rather than prettily.
  expect(evaluated('String(rational(0.1));')).toBe('3602879701896397/36028797018963968');
  // A decimal converts to the power-of-ten fraction decimal.md names.
  expect(evaluated("let d = decimal64('0.1'); String(rational(d));")).toBe('1/10');
});

test('the constructor and its failures are unchanged', () => {
  expect(evaluated('String(rational(5));')).toBe('5');
  expect(evaluated('String(rational(1, 10));')).toBe('1/10');
  expectThrownKind('rational(1, 0);', 'RangeError');
  // "A *RangeError* ... if the source is NaN or an infinity" - neither has an
  // exact value to be the fraction of.
  expectThrownKind('rational(NaN);', 'RangeError');
  expectThrownKind('rational(Infinity);', 'RangeError');
});
