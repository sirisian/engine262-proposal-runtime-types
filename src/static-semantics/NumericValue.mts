import { TypedNumberValue, Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { BigIntContextLiteralValue, FloatContextLiteralWidth, DecimalContextLiteralWidth, WideIntegerContextLiteral, RationalContextLiteralDigits, ComplexContextRealLiteralComponent, ComplexContextLiteralComponent, type DeferredLiteral } from '../type-system/check.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { wrapToType } from '../type-system/arithmetic.mts';
import type { ThrowCompletion } from '../completion.mts';
import { CreateDecimalValue, DecimalPartsInRange, ParseDecimalDigits, decimalDivide } from '../intrinsics/Decimal.mts';
import { CreateComplexValue } from '../intrinsics/Complex.mts';
import { CreateRationalValue } from '../intrinsics/Rational.mts';
import { Binary128ToFloat128 } from '../intrinsics/Float128.mts';
import { fromDecimal as Float128FromDecimal, divide as Float128Divide } from '../intrinsics/Float128Arithmetic.mts';
import { roundRationalToBinaryFloat } from '../intrinsics/BinaryFloatRounding.mts';
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
  // A REAL literal the checker read at a complex type is born as that complex,
  // real part the literal and imaginary part zero, at the context's component -
  // the real-axis counterpart of the branch above.
  const realComponent = ComplexContextRealLiteralComponent(node);
  if (realComponent !== undefined && typeof node.value === 'number') {
    return CreateComplexValue(Number(node.value), 0, realComponent, surroundingAgent.currentRealmRecord);
  }
  const integer = typeof node.value === 'number' ? BigIntContextLiteralValue(node) : undefined;
  if (integer !== undefined) {
    return Value(integer);
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
    const { sig, exp, type } = rational;
    return exp >= 0
      ? CreateRationalValue(sig * 10n ** BigInt(exp), 1n, surroundingAgent.currentRealmRecord, type)
      : CreateRationalValue(sig, 10n ** BigInt(-exp), surroundingAgent.currentRealmRecord, type);
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
    // A float128 is wider than a Number, so its literal is a float128 object:
    // the digits' exact value rounded once to binary128's 113 bits.
    if (digits !== undefined && floatWidth === 128) {
      return Binary128ToFloat128(Float128FromDecimal(digits.significand, digits.exponent), surroundingAgent.currentRealmRecord);
    }
    // A NON-DECIMAL integer literal - `0x`, `0o`, `0b` - names an exact integer
    // too, which ParseDecimalDigits does not read: it fell through to the double
    // below, so `float128(0x20000000000001)` was 2**53, the double's rounding,
    // where binary128 holds 2**53 + 1 exactly. The narrower widths are left to
    // the double, which holds every integer they round from below 2**53.
    if (digits === undefined && floatWidth === 128) {
      const text = node.SourceText.replace(/_/g, '');
      if (/^0[xXoObB][0-9a-fA-F]+$/.test(text)) {
        return Binary128ToFloat128(Float128FromDecimal(BigInt(text), 0), surroundingAgent.currentRealmRecord);
      }
    }
    if (digits !== undefined && floatWidth !== 128) {
      return Value(RoundDecimalToBinaryFloat(digits.significand, digits.exponent, floatWidth));
    }
  }
  return Value(node.value);
}

/**
 * The value a conversion's literal operand has at the type _t_ that its
 * type-parameter target resolved to (`DeferredConversionLiteral`), read as the
 * checker's marks and `NumericValue` read it where the type is written: an
 * integer type takes the exact integer, wrapped, or the integer part of the
 * exact fraction; `bigint` the exact integer; a rational the fraction; a
 * decimal the digits; a binary float narrower or wider than a Number the bare
 * literal's digits, rounded once. Undefined where the type takes the Number the
 * operand evaluates to; the conversion then converts whichever it has.
 */
export function DeferredLiteralValue(deferred: DeferredLiteral, t: TypeRecord): Value | ThrowCompletion | undefined {
  if (t.Kind !== 'primitive') return undefined;
  const realm = surroundingAgent.currentRealmRecord;
  switch (t.Name) {
    case 'int':
    case 'uint': {
      // BigInt division truncates toward zero, as the conversion of a fraction does.
      const exact = deferred.integer ?? (deferred.rational ? deferred.rational.num / deferred.rational.den : null);
      return exact === null ? undefined : new TypedNumberValue(wrapToType(exact, t), t);
    }
    case 'bigint':
      return deferred.integer === null ? undefined : Value(deferred.integer);
    case 'rational':
      return deferred.rational === null ? undefined
        : CreateRationalValue(deferred.rational.num, deferred.rational.den, realm, t);
    case 'decimal32':
    case 'decimal64':
    case 'decimal128': {
      const width = Number(t.Name.slice('decimal'.length)) as 32 | 64 | 128;
      if (deferred.decimal !== null) return CreateDecimalValue(deferred.decimal.sig, deferred.decimal.exp, width, realm, t);
      // A constant that divides is the decimal quotient of its exact fraction,
      // rounded once in the type, as `1 / 3 := decimal128` is: through a type
      // parameter it was the double's third written out to 34 digits.
      const rational = deferred.rational;
      if (rational === null || !DecimalPartsInRange({ significand: rational.num, exponent: 0 }, width)
        || !DecimalPartsInRange({ significand: rational.den, exponent: 0 }, width)) return undefined;
      const quotient = decimalDivide(CreateDecimalValue(rational.num, 0, width, realm), CreateDecimalValue(rational.den, 0, width, realm));
      if (typeof quotient !== 'object' || quotient.parts.special !== undefined) return undefined;
      return CreateDecimalValue(quotient.parts.significand, quotient.parts.exponent, width, realm, t);
    }
    case 'float16':
    case 'float32':
    case 'float128': {
      const literal = deferred.literal;
      // At `float128`, a constant is its exact fraction rounded once, as `1 / 3
      // := float128` is; through a type parameter it was the double's third.
      // Each integer of the fraction is exact in the format up to 2**113.
      const rational = deferred.rational;
      if (literal === null && t.Name === 'float128' && rational !== null
          && (rational.num < 0n ? -rational.num : rational.num) < 2n ** 113n && rational.den < 2n ** 113n) {
        return Binary128ToFloat128(Float128Divide(Float128FromDecimal(rational.num, 0), Float128FromDecimal(rational.den, 0)), realm);
      }
      if (literal === null) return undefined;
      const digits = ParseDecimalDigits(literal.text);
      if (t.Name === 'float128') {
        const integerText = /^0[xXoObB][0-9a-fA-F]+$/.test(literal.text) ? BigInt(literal.text) : undefined;
        const significand = digits !== undefined ? digits.significand : integerText;
        // A zero keeps the Number path, where the sign of a negative zero survives.
        if (significand === undefined || significand === 0n) return undefined;
        const signed = literal.negative ? -significand : significand;
        return Binary128ToFloat128(Float128FromDecimal(signed, digits !== undefined ? digits.exponent : 0), realm);
      }
      if (digits === undefined) return undefined;
      const rounded = RoundDecimalToBinaryFloat(digits.significand, digits.exponent, t.Name === 'float16' ? 16 : 32);
      return Value(literal.negative ? -rounded : rounded);
    }
    default:
      return undefined;
  }
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
  // A value hundreds of decades past either format is an infinity or a zero,
  // without its power of ten being written out (Question BM): `float32(1e999999999)`
  // crashed the host with "Maximum BigInt size exceeded".
  const magnitude = (significand < 0n ? -significand : significand).toString().length + exponent;
  if (significand !== 0n && magnitude > 400) return significand < 0n ? -Infinity : Infinity;
  if (significand !== 0n && magnitude < -400) return significand < 0n ? -0 : 0;
  return exponent >= 0
    ? roundRationalToBinaryFloat(significand * 10n ** BigInt(exponent), 1n, width)
    : roundRationalToBinaryFloat(significand, 10n ** BigInt(-exponent), width);
}

/**
 * The value a numeric literal written as a member of an object literal has at
 * its field's type where the checker did not know that type, as through a
 * type parameter, `{ n: 9007199254740993 } := T`: read from the literal's
 * source text, as the checker reads it where the class is written, so a value
 * past 2**53 is not the double the lexer made of it. Undefined where _node_
 * is not such a literal or the type reads nothing from its text.
 */
export function LiteralTextValueAt(node: ParseNode, t: TypeRecord): Value | ThrowCompletion | undefined {
  let core: ParseNode = node;
  let negative = false;
  for (let depth = 0; depth < 64; depth += 1) {
    if (core.type === 'ParenthesizedExpression') core = core.Expression;
    else if (core.type === 'UnaryExpression' && (core.operator === '-' || core.operator === '+')) {
      if (core.operator === '-') negative = !negative;
      core = core.UnaryExpression;
    } else break;
  }
  if (core.type !== 'NumericLiteral' || typeof core.value !== 'number' || typeof core.SourceText !== 'string') return undefined;
  const text = core.SourceText.replace(/_/g, '');
  const radix = /^0[xXoObB][0-9a-fA-F]+$/.test(text) ? BigInt(text) : undefined;
  const digits = radix === undefined ? ParseDecimalDigits(text) : { significand: radix, exponent: 0 };
  if (digits === undefined) return undefined;
  const sig = negative ? -digits.significand : digits.significand;
  const scale = digits.exponent >= 0 ? 1n : 10n ** BigInt(-digits.exponent);
  const whole = digits.exponent >= 0 ? sig * 10n ** BigInt(Math.min(digits.exponent, 4096)) : sig;
  const integer = digits.exponent >= 0 && digits.exponent <= 4096 ? whole : (sig % scale === 0n ? sig / scale : null);
  return DeferredLiteralValue({
    integer,
    rational: digits.exponent <= 4096 ? { num: whole, den: scale } : null,
    decimal: { sig, exp: digits.exponent },
    literal: { text, negative },
  }, t);
}
