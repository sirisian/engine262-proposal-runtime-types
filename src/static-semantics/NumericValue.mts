import { TypedNumberValue, Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { IsBigIntContextLiteral, FloatContextLiteralWidth, DecimalContextLiteralWidth, WideIntegerContextLiteral, RationalContextLiteralDigits, ComplexContextLiteralComponent } from '../type-system/check.mts';
import { CreateDecimalValue, ParseDecimalDigits } from '../intrinsics/Decimal.mts';
import { CreateComplexValue } from '../intrinsics/Complex.mts';
import { CreateRationalValue } from '../intrinsics/Rational.mts';
import { surroundingAgent } from '#self';

/**
 * proposal-runtime-types: a literal the checker read at `bigint` evaluates to
 * the BigInt its SOURCE TEXT denotes, not to the double the lexer produced.
 * The two have to agree - the checker admitted the literal on the strength of
 * the exact value, so the run time must produce it - and the double is already
 * wrong by then: `9007199254740993` is ...992 from the moment it is scanned
 * Every other literal is unaffected and answers exactly as before.
 */
export function NumericValue(node: ParseNode.NumericLiteral) {
  // proposal-runtime-types #sec-complex-numbers: "An imaginary literal has the
  // type `complex`, with the literal's value as its imaginary component and zero
  // as its real one, so `4i` is `complex(0, 4)`." The lexer scanned the
  // magnitude; the axis is what the suffix said.
  if ((node as { Imaginary?: boolean }).Imaginary) {
    // The component the CONTEXT asked for, where it asked for one: a `4i` in a
    // `complex64` position is a `complex.<float32>`, not a `complex.<number>`
    // that the store would then refuse.
    const component = ComplexContextLiteralComponent(node);
    return CreateComplexValue(0, Number(node.value), component, surroundingAgent.currentRealmRecord);
  }
  if (typeof node.value === 'number' && typeof node.SourceText === 'string' && IsBigIntContextLiteral(node)) {
    return Value(BigInt(node.SourceText.replace(/_/g, '')));
  }
  // A literal the checker read at a DECIMAL type evaluates to the decimal its
  // SOURCE TEXT denotes, and the reason is sharper than bigint's: the double is
  // not merely imprecise here, it cannot represent the answer at all. `1.0` and
  // `1.00` are ONE double and TWO decimals, so the cohort member exists only in
  // the text.
  // A literal the checker read at a WIDE INTEGER type evaluates to the exact
  // integer its source text denotes. #sec-integer-types gives such a type
  // "exactly 2**N values" and a double distinguishes them only to 53 bits, so
  // `let x: int64 = 9007199254740993;` was the double ...992 before the type was
  // ever consulted. The checker carries the value AND the type here, so the
  // literal becomes a value of that type directly rather than a BigInt that the
  // boundary would have to convert - a boundary the checker is entitled to
  // elide, which would leave the BigInt as the binding's value.
  const wide = WideIntegerContextLiteral(node);
  if (wide !== undefined) {
    return new TypedNumberValue(wide.value, wide.type);
  }
  // A literal the checker read at a RATIONAL type becomes that rational from its
  // DIGITS, on the same terms as the decimal mark below: `0.1` in a rational
  // position is 1/10 (#sec-literal-types), and the double nearest one tenth is
  // not one tenth. A rational does not round, so building one from the double
  // would give 3602879701896397/36028797018963968 - the Number's true value, and
  // the wrong answer for the literal.
  const rational = RationalContextLiteralDigits(node);
  if (rational !== undefined) {
    const { sig, exp } = rational;
    return exp >= 0
      ? CreateRationalValue(sig * 10n ** BigInt(exp), 1n, surroundingAgent.currentRealmRecord)
      : CreateRationalValue(sig, 10n ** BigInt(-exp), surroundingAgent.currentRealmRecord);
  }
  const source = typeof node.SourceText === 'string' ? node.SourceText : undefined;
  const width = source !== undefined ? DecimalContextLiteralWidth(node) : undefined;
  if (width !== undefined && source !== undefined) {
    const digits = ParseDecimalDigits(source.replace(/_/g, ''));
    if (digits) {
      return CreateDecimalValue(digits.significand, digits.exponent, width, surroundingAgent.currentRealmRecord);
    }
  }
  // A literal the checker read at a `float16` or `float32` is rounded ONCE, from
  // its source digits, to that format - #sec-literalvalueintype. The result is a
  // value of the format, and every value of a narrower binary format is exactly a
  // Number, so the conversion to the type that follows leaves it unchanged
  // rather than rounding again.
  const floatWidth = FloatContextLiteralWidth(node);
  if (floatWidth !== undefined && typeof node.SourceText === 'string') {
    const digits = ParseDecimalDigits(node.SourceText.replace(/_/g, ''));
    if (digits !== undefined) {
      return Value(RoundDecimalToBinaryFloat(digits.significand, digits.exponent, floatWidth));
    }
  }
  return Value(node.value);
}

/**
 * The value of a binary float format nearest to `significand * 10**exponent`,
 * ties to even, computed exactly - one rounding, as IEEE 754 requires of a
 * conversion from a decimal character sequence. `float32` has a 24-bit
 * significand and exponents -126..127, `float16` 11 bits and -14..15; values
 * below the least normal are subnormal, and a value that rounds beyond the
 * largest finite one is infinite.
 */
function RoundDecimalToBinaryFloat(significand: bigint, exponent: number, width: 16 | 32): number {
  if (significand === 0n) {
    return 0;
  }
  const [precision, emin, emax] = width === 32 ? [24, -126, 127] : [11, -14, 15];
  let num = significand;
  let den = 1n;
  if (exponent >= 0) {
    num *= 10n ** BigInt(exponent);
  } else {
    den = 10n ** BigInt(-exponent);
  }
  // `atLeast(k)` is num/den >= 2**k.
  const atLeast = (k: number) => (k >= 0 ? num >= den << BigInt(k) : num << BigInt(-k) >= den);
  let e = num.toString(2).length - den.toString(2).length;
  while (!atLeast(e)) e -= 1;
  while (atLeast(e + 1)) e += 1;
  if (e > emax) {
    return Infinity;
  }
  // The exponent of the last significand bit; below the least normal it is fixed.
  const ulp = Math.max(e, emin) - (precision - 1);
  let n = num;
  let d = den;
  if (ulp >= 0) {
    d <<= BigInt(ulp);
  } else {
    n <<= BigInt(-ulp);
  }
  let m = n / d;
  const twice = (n - m * d) * 2n;
  if (twice > d || (twice === d && (m & 1n) === 1n)) {
    m += 1n;
  }
  const value = Number(m) * 2 ** ulp;
  const largest = (2 - 2 ** (1 - precision)) * 2 ** emax;
  return value > largest ? Infinity : value;
}
