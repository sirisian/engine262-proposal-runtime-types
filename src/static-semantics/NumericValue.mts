import { TypedNumberValue, Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { IsBigIntContextLiteral, DecimalContextLiteralWidth, WideIntegerContextLiteral } from '../type-system/check.mts';
import { CreateDecimalValue, ParseDecimalDigits } from '../intrinsics/Decimal.mts';
import { surroundingAgent } from '#self';

/**
 * proposal-runtime-types: a literal the checker read at `bigint` evaluates to
 * the BigInt its SOURCE TEXT denotes, not to the double the lexer produced.
 * The two have to agree - the checker admitted the literal on the strength of
 * the exact value, so the run time must produce it - and the double is already
 * wrong by then: `9007199254740993` is ...992 from the moment it is scanned
 * (F67). Every other literal is unaffected and answers exactly as before.
 */
export function NumericValue(node: ParseNode.NumericLiteral) {
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
  const source = typeof node.SourceText === 'string' ? node.SourceText : undefined;
  const width = source !== undefined ? DecimalContextLiteralWidth(node) : undefined;
  if (width !== undefined && source !== undefined) {
    const digits = ParseDecimalDigits(source.replace(/_/g, ''));
    if (digits) {
      return CreateDecimalValue(digits.significand, digits.exponent, width, surroundingAgent.currentRealmRecord);
    }
  }
  return Value(node.value);
}
